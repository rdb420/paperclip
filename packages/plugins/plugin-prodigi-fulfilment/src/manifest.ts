import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { PLUGIN_ID, PLUGIN_VERSION, TOOL_NAMES, DEFAULT_A3_SKU } from "./constants.js";

const SHIPPING_METHODS = [
  "Budget",
  "Standard",
  "StandardPlus",
  "Express",
  "Overnight",
] as const;

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Prodigi Fulfilment (Quotes)",
  description:
    "Captures authenticated Prodigi Print API quotes (unit cost + freight + packaging treatment) and confirms the TD-PRINT-FOOL-A3 Economic gate against actuals. Quote/product calls only — never places orders or spends.",
  author: "Paperclip",
  categories: ["connector", "automation"],
  capabilities: [
    "http.outbound",
    "secrets.read-ref",
    "agent.tools.register",
    "instance.settings.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      apiKey: {
        type: "string",
        format: "secret-ref",
        title: "Prodigi API key",
        description:
          "Prodigi Print API key, sent as the X-API-Key header. Paste your key or pick a saved Paperclip secret. Stored as a secret reference, never in plain config.",
      },
      environment: {
        type: "string",
        title: "Prodigi environment",
        enum: ["live", "sandbox"],
        default: "live",
        description:
          "Which Prodigi API to call. Quote and product lookups never charge in either environment; only order placement would (this plugin does not place orders). Note: a live key is rejected by the sandbox host and vice-versa.",
      },
      baseUrlOverride: {
        type: "string",
        title: "Base URL override",
        description:
          "Advanced: override the Prodigi base URL entirely (e.g. a recorded fixture server). Leave blank to use the selected environment.",
        "x-paperclip-advanced": true,
      },
    },
    required: ["apiKey"],
  },
  tools: [
    {
      name: TOOL_NAMES.quote,
      displayName: "Prodigi quote",
      description:
        "Fetch an authenticated Prodigi quote for a SKU shipped to a destination. Returns unit cost, freight, fulfilment lab, and packaging treatment. Read-only pricing — places no order.",
      parametersSchema: {
        type: "object",
        properties: {
          sku: {
            type: "string",
            description: "Prodigi product SKU, e.g. GLOBAL-FAP-A3.",
          },
          destinationCountryCode: {
            type: "string",
            description: "ISO 3166-1 alpha-2 destination country, e.g. US or AU.",
          },
          shippingMethod: {
            type: "string",
            enum: [...SHIPPING_METHODS],
            default: "Budget",
          },
          copies: { type: "integer", minimum: 1, default: 1 },
          currencyCode: {
            type: "string",
            description: "Optional ISO 4217 currency, e.g. USD or AUD.",
          },
          attributes: {
            type: "object",
            description: "Optional Prodigi product attributes.",
            additionalProperties: { type: "string" },
          },
        },
        required: ["sku", "destinationCountryCode"],
      },
    },
    {
      name: TOOL_NAMES.gateCheck,
      displayName: "Prodigi gate check (TD-PRINT-FOOL-A3)",
      description:
        "Capture A1 (unit cost), A2 (freight) and A7 (packaging) for the A3 giclée SKU in the AU and US markets and evaluate the operator-approved Economic-gate ceilings. Confirmation checkpoint only: does not authorize spend, place orders, or re-approve the gate.",
      parametersSchema: {
        type: "object",
        properties: {
          sku: {
            type: "string",
            default: DEFAULT_A3_SKU,
            description: `A3 giclée SKU to price. Defaults to ${DEFAULT_A3_SKU}.`,
          },
          shippingMethod: {
            type: "string",
            enum: [...SHIPPING_METHODS],
            default: "Budget",
          },
        },
      },
    },
    {
      name: TOOL_NAMES.product,
      displayName: "Prodigi product details",
      description:
        "Fetch Prodigi product details (dimensions, print areas, attributes) for a SKU. Useful for confirming A7 packaging/format treatment.",
      parametersSchema: {
        type: "object",
        properties: {
          sku: { type: "string", description: "Prodigi product SKU." },
        },
        required: ["sku"],
      },
    },
  ],
};

export default manifest;
