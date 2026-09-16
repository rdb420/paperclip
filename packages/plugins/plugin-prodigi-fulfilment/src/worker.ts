import {
  definePlugin,
  runWorker,
  type PaperclipPlugin,
  type PluginContext,
  type ToolResult,
  type ToolRunContext,
  type EnvSecretRefBinding,
} from "@paperclipai/plugin-sdk";

import {
  DEFAULT_A3_SKU,
  DEFAULT_CONFIG,
  PLUGIN_ID,
  TOOL_NAMES,
  type ProdigiPluginConfig,
} from "./constants.js";
import {
  ProdigiApiError,
  ProdigiClient,
  type FetchImpl,
  type ProdigiEnv,
  type ProdigiQuoteRequest,
  type ProdigiShippingMethod,
} from "./prodigi-client.js";
import { captureFigures, evaluateGate } from "./gate.js";

function isSecretRefBinding(value: unknown): value is EnvSecretRefBinding {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { type?: unknown }).type === "secret_ref" &&
    typeof (value as { secretId?: unknown }).secretId === "string"
  );
}

async function getConfig(
  ctx: PluginContext,
  companyId?: string,
): Promise<ProdigiPluginConfig> {
  const raw = (await ctx.config.get(companyId)) as ProdigiPluginConfig;
  return { ...DEFAULT_CONFIG, ...raw };
}

async function resolveApiKey(
  ctx: PluginContext,
  config: ProdigiPluginConfig,
  companyId: string,
): Promise<string> {
  // Preferred: a secret-ref bound in plugin settings, resolved by the host.
  if (isSecretRefBinding(config.apiKey)) {
    return ctx.secrets.resolve(config.apiKey, { companyId, configPath: "apiKey" });
  }
  // Fallback: PRODIGI_X_API_KEY injected into the server/worker environment
  // (the phase-a compose passes it through). Single-tenant, trusted-local only.
  const envKey = process.env.PRODIGI_X_API_KEY?.trim();
  if (envKey) return envKey;
  throw new Error(
    "Prodigi API key is not configured. Set the plugin's `apiKey` secret in Settings, " +
      "or provide PRODIGI_X_API_KEY in the server environment.",
  );
}

async function makeClient(
  ctx: PluginContext,
  companyId: string,
): Promise<ProdigiClient> {
  const config = await getConfig(ctx, companyId);
  const apiKey = await resolveApiKey(ctx, config, companyId);
  // ctx.http.fetch is capability-gated (http.outbound) and returns a standard
  // Response, which structurally satisfies FetchImpl.
  const fetchImpl: FetchImpl = (url, init) => ctx.http.fetch(url, init);
  const env: ProdigiEnv = config.environment === "sandbox" ? "sandbox" : "live";
  return new ProdigiClient({
    apiKey,
    env,
    baseUrlOverride: config.baseUrlOverride?.trim() || undefined,
    fetchImpl,
  });
}

function toToolError(err: unknown): ToolResult {
  if (err instanceof ProdigiApiError) {
    return {
      error: `Prodigi API error (HTTP ${err.status}): ${err.body.slice(0, 500)}`,
    };
  }
  return { error: err instanceof Error ? err.message : String(err) };
}

async function runQuote(
  ctx: PluginContext,
  companyId: string,
  req: ProdigiQuoteRequest,
) {
  const client = await makeClient(ctx, companyId);
  const response = await client.getQuote(req);
  const figures = captureFigures(response, req.destinationCountryCode);
  const gate = evaluateGate(figures);
  return { response, figures, gate };
}

const plugin: PaperclipPlugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("Prodigi fulfilment plugin starting", { pluginId: PLUGIN_ID });

    ctx.tools.register(
      TOOL_NAMES.quote,
      {
        displayName: "Prodigi quote",
        description:
          "Authenticated Prodigi quote for a SKU + destination. Read-only pricing; places no order.",
        parametersSchema: {
          type: "object",
          properties: {
            sku: { type: "string" },
            destinationCountryCode: { type: "string" },
            shippingMethod: { type: "string" },
            copies: { type: "integer", minimum: 1 },
            currencyCode: { type: "string" },
            attributes: { type: "object", additionalProperties: { type: "string" } },
          },
          required: ["sku", "destinationCountryCode"],
        },
      },
      async (params, runCtx: ToolRunContext): Promise<ToolResult> => {
        try {
          const p = params as {
            sku: string;
            destinationCountryCode: string;
            shippingMethod?: ProdigiShippingMethod;
            copies?: number;
            currencyCode?: string;
            attributes?: Record<string, string>;
          };
          const { figures, gate } = await runQuote(ctx, runCtx.companyId, {
            shippingMethod: p.shippingMethod ?? "Budget",
            destinationCountryCode: p.destinationCountryCode,
            currencyCode: p.currencyCode,
            items: [
              {
                sku: p.sku,
                copies: p.copies ?? 1,
                attributes: p.attributes ?? {},
                assets: [{ printArea: "default" }],
              },
            ],
          });
          const unit = figures.unitCost
            ? `${figures.unitCost.currency} ${figures.unitCost.amount.toFixed(2)}`
            : "n/a";
          const ship = figures.shipping
            ? `${figures.shipping.currency} ${figures.shipping.amount.toFixed(2)}`
            : "n/a";
          const lab = figures.fulfillmentLocation
            ? `${figures.fulfillmentLocation.labCode} (${figures.fulfillmentLocation.countryCode})`
            : "unknown";
          return {
            content: `${p.sku} → ${p.destinationCountryCode}: unit ${unit}, freight ${ship}, lab ${lab}. Gate: ${gate.status}.`,
            data: { figures, gate },
          };
        } catch (err) {
          return toToolError(err);
        }
      },
    );

    ctx.tools.register(
      TOOL_NAMES.gateCheck,
      {
        displayName: "Prodigi gate check (TD-PRINT-FOOL-A3)",
        description:
          "Capture A1/A2/A7 for the A3 giclée SKU in AU and US and evaluate the Economic gate. Confirmation only; authorizes nothing.",
        parametersSchema: {
          type: "object",
          properties: {
            sku: { type: "string" },
            shippingMethod: { type: "string" },
          },
        },
      },
      async (params, runCtx: ToolRunContext): Promise<ToolResult> => {
        try {
          const p = params as { sku?: string; shippingMethod?: ProdigiShippingMethod };
          const sku = p.sku ?? DEFAULT_A3_SKU;
          const shippingMethod = p.shippingMethod ?? "Budget";
          const markets: Array<{ destinationCountryCode: string; currencyCode: string; label: string }> = [
            { destinationCountryCode: "AU", currencyCode: "AUD", label: "AU (facility)" },
            { destinationCountryCode: "US", currencyCode: "USD", label: "US (primary market)" },
          ];

          const captured = [];
          for (const m of markets) {
            const { figures, gate } = await runQuote(ctx, runCtx.companyId, {
              shippingMethod,
              destinationCountryCode: m.destinationCountryCode,
              currencyCode: m.currencyCode,
              items: [{ sku, copies: 1, attributes: {}, assets: [{ printArea: "default" }] }],
            });
            captured.push({ market: m.label, sku, figures, gate });
          }

          const anyNegative = captured.some((c) => c.gate.status === "flips_negative");
          const lines = captured.map((c) => {
            const u = c.figures.unitCost;
            const s = c.figures.shipping;
            return `${c.market}: A1 ${u ? `${u.currency} ${u.amount.toFixed(2)}` : "n/a"}, A2 ${
              s ? `${s.currency} ${s.amount.toFixed(2)}` : "n/a"
            }, lab ${c.figures.fulfillmentLocation?.labCode ?? "?"} → gate ${c.gate.status}`;
          });

          return {
            content:
              `Prodigi gate check for ${sku} (${shippingMethod} shipping):\n` +
              lines.join("\n") +
              `\n\nOverall: ${anyNegative ? "GATE FLIPS NEGATIVE against actuals" : "gate holds against actuals"}. ` +
              `Confirmation checkpoint only — this does not authorize spend, place an order, or re-approve the gate. Hand these figures to Finance to re-confirm the model.`,
            data: { sku, shippingMethod, captured, anyNegative },
          };
        } catch (err) {
          return toToolError(err);
        }
      },
    );

    ctx.tools.register(
      TOOL_NAMES.product,
      {
        displayName: "Prodigi product details",
        description: "Prodigi product details (dimensions, print areas, attributes) for a SKU.",
        parametersSchema: {
          type: "object",
          properties: { sku: { type: "string" } },
          required: ["sku"],
        },
      },
      async (params, runCtx: ToolRunContext): Promise<ToolResult> => {
        try {
          const p = params as { sku: string };
          const client = await makeClient(ctx, runCtx.companyId);
          const product = await client.getProduct(p.sku);
          const desc = product.product?.description ?? "(no description)";
          const dims = product.product?.productDimensions;
          return {
            content: `${p.sku}: ${desc}${
              dims ? ` — ${dims.width}x${dims.height}${dims.units}` : ""
            }`,
            data: product,
          };
        } catch (err) {
          return toToolError(err);
        }
      },
    );
  },

  async onHealth() {
    return { status: "ok", message: "Prodigi fulfilment plugin ready (quote/product tools registered)." };
  },

  async onValidateConfig(config) {
    const cfg = config as ProdigiPluginConfig;
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!isSecretRefBinding(cfg.apiKey)) {
      if (process.env.PRODIGI_X_API_KEY?.trim()) {
        warnings.push(
          "No apiKey secret set — falling back to PRODIGI_X_API_KEY from the server environment.",
        );
      } else {
        errors.push(
          "Prodigi API key is not configured: set the apiKey secret, or provide PRODIGI_X_API_KEY in the server environment.",
        );
      }
    }
    if (cfg.environment && cfg.environment !== "live" && cfg.environment !== "sandbox") {
      errors.push(`environment must be "live" or "sandbox", got "${cfg.environment}".`);
    }
    if ((cfg.environment ?? DEFAULT_CONFIG.environment) === "sandbox") {
      warnings.push(
        "Sandbox environment selected — pricing may not match live actuals, and a live API key is rejected by the sandbox host.",
      );
    }
    return { ok: errors.length === 0, errors, warnings };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
