import { describe, expect, it, vi } from "vitest";
import {
  ProdigiApiError,
  ProdigiClient,
  type ProdigiQuoteResponse,
} from "../src/prodigi-client.js";
import { captureFigures, evaluateGate } from "../src/gate.js";
import manifest from "../src/manifest.js";
import { TOOL_NAMES } from "../src/constants.js";

function auQuoteResponse(): ProdigiQuoteResponse {
  return {
    outcome: "Created",
    quotes: [
      {
        shipmentMethod: "Budget",
        costSummary: {
          items: { amount: "18.00", currency: "AUD" },
          shipping: { amount: "14.00", currency: "AUD" },
        },
        shipments: [
          {
            carrier: { name: "Australia Post", service: "e-parcel" },
            fulfillmentLocation: { countryCode: "AU", labCode: "au6" },
            cost: { amount: "14.00", currency: "AUD" },
            items: ["qit_1"],
          },
        ],
        items: [
          {
            id: "qit_1",
            sku: "GLOBAL-FAP-A3",
            copies: 1,
            unitCost: { amount: "18.00", currency: "AUD" },
            attributes: {},
            assets: [{ printArea: "default" }],
          },
        ],
      },
    ],
  };
}

describe("manifest", () => {
  it("declares the required capabilities and tools", () => {
    expect(manifest.capabilities).toEqual(
      expect.arrayContaining([
        "http.outbound",
        "secrets.read-ref",
        "agent.tools.register",
      ]),
    );
    const toolNames = (manifest.tools ?? []).map((t) => t.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([TOOL_NAMES.quote, TOOL_NAMES.gateCheck, TOOL_NAMES.product]),
    );
  });

  it("declares apiKey as a secret-ref with no default", () => {
    const apiKey = (manifest.instanceConfigSchema as any).properties.apiKey;
    expect(apiKey.format).toBe("secret-ref");
    expect(apiKey).not.toHaveProperty("default");
  });
});

describe("captureFigures", () => {
  it("extracts A1/A2/A7 and the fulfilment lab", () => {
    const figures = captureFigures(auQuoteResponse(), "AU");
    expect(figures.unitCost).toEqual({ amount: 18, currency: "AUD" });
    expect(figures.shipping).toEqual({ amount: 14, currency: "AUD" });
    expect(figures.fulfillmentLocation).toEqual({ countryCode: "AU", labCode: "au6" });
    expect(figures.packaging.bundledInUnitPrice).toBe(true);
    expect(figures.sku).toBe("GLOBAL-FAP-A3");
  });
});

describe("evaluateGate", () => {
  it("flips negative when AU unit cost and freight both breach ceilings", () => {
    const evaluation = evaluateGate(captureFigures(auQuoteResponse(), "AU"));
    expect(evaluation.status).toBe("flips_negative");
    expect(evaluation.unitCostBreached).toBe(true);
    expect(evaluation.shippingBreached).toBe(true);
    expect(evaluation.disclaimer).toMatch(/does not authorize/i);
  });

  it("holds when both figures are within the ceilings", () => {
    const res = auQuoteResponse();
    res.quotes[0].items[0].unitCost.amount = "12.00";
    res.quotes[0].costSummary.shipping.amount = "9.00";
    const evaluation = evaluateGate(captureFigures(res, "AU"));
    expect(evaluation.status).toBe("holds");
    expect(evaluation.unitCostBreached).toBe(false);
    expect(evaluation.shippingBreached).toBe(false);
  });

  it("is indeterminate for a currency with no thresholds", () => {
    const res = auQuoteResponse();
    res.quotes[0].items[0].unitCost.currency = "GBP";
    res.quotes[0].costSummary.shipping.currency = "GBP";
    const evaluation = evaluateGate(captureFigures(res, "GB"));
    expect(evaluation.status).toBe("indeterminate");
  });
});

describe("ProdigiClient", () => {
  it("sends the X-API-Key header and parses a quote", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: any) => {
      expect(init.headers["X-API-Key"]).toBe("secret-key");
      return { status: 200, text: async () => JSON.stringify(auQuoteResponse()) };
    });
    const client = new ProdigiClient({ apiKey: "secret-key", env: "live", fetchImpl });
    const res = await client.getQuote({
      shippingMethod: "Budget",
      destinationCountryCode: "AU",
      currencyCode: "AUD",
      items: [{ sku: "GLOBAL-FAP-A3", copies: 1, assets: [{ printArea: "default" }] }],
    });
    expect(res.quotes[0].items[0].unitCost.amount).toBe("18.00");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0]).toContain("api.prodigi.com/v4.0/quotes");
  });

  it("throws ProdigiApiError on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => ({ status: 401, text: async () => "unauthorized" }));
    const client = new ProdigiClient({ apiKey: "bad", env: "live", fetchImpl });
    await expect(
      client.getQuote({
        shippingMethod: "Budget",
        destinationCountryCode: "AU",
        items: [{ sku: "X", copies: 1 }],
      }),
    ).rejects.toBeInstanceOf(ProdigiApiError);
  });
});
