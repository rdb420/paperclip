// Prodigi Print API v4.0 client — SDK-independent.
//
// Covers the two endpoints TD-PRINT-FOOL-A3 needs:
//   - POST /v4.0/quotes    → authenticated pricing (unit cost + shipping)
//   - GET  /v4.0/products/{sku} → dimensions / attributes / print areas
//
// This module deliberately takes an injected `fetchImpl` so it can be driven by
// the plugin host's capability-gated outbound HTTP (`ctx.http`) in production
// and by a stub in tests. It never reads process.env or global fetch directly.

export type ProdigiEnv = "live" | "sandbox";

export const PRODIGI_BASE_URLS: Record<ProdigiEnv, string> = {
  live: "https://api.prodigi.com/v4.0",
  sandbox: "https://api.sandbox.prodigi.com/v4.0",
};

export type ProdigiShippingMethod =
  | "Budget"
  | "Standard"
  | "StandardPlus"
  | "Express"
  | "Overnight";

export interface ProdigiMoney {
  amount: string; // decimal string, e.g. "14.37"
  currency: string; // ISO 4217, e.g. "GBP"
}

export interface ProdigiQuoteItemInput {
  sku: string;
  copies: number;
  attributes?: Record<string, string>;
  assets?: Array<{ printArea: string; pageCount?: number }>;
}

export interface ProdigiQuoteRequest {
  shippingMethod: ProdigiShippingMethod;
  destinationCountryCode: string; // ISO 3166-1 alpha-2, e.g. "US", "AU"
  currencyCode?: string; // optional; defaults to the account/destination currency
  items: ProdigiQuoteItemInput[];
}

export interface ProdigiQuoteLineItem {
  id: string;
  sku: string;
  copies: number;
  unitCost: ProdigiMoney;
  attributes?: Record<string, string>;
  assets?: Array<{ printArea: string }>;
}

export interface ProdigiFulfillmentLocation {
  countryCode: string; // e.g. "AU"
  labCode: string; // e.g. "au1"
}

export interface ProdigiShipment {
  carrier: { name: string; service: string };
  fulfillmentLocation: ProdigiFulfillmentLocation;
  cost: ProdigiMoney;
  items: string[]; // quote line-item ids
}

export interface ProdigiQuote {
  shipmentMethod: string;
  costSummary: {
    items: ProdigiMoney;
    shipping: ProdigiMoney;
  };
  shipments: ProdigiShipment[];
  items: ProdigiQuoteLineItem[];
}

export interface ProdigiQuoteResponse {
  outcome: "Created" | "CreatedWithIssues" | string;
  quotes: ProdigiQuote[];
}

export interface ProdigiProductResponse {
  outcome?: string;
  product?: {
    sku: string;
    description: string;
    productDimensions?: { width: number; height: number; units: string };
    attributes?: Record<string, string[]>;
    printAreas?: Record<string, { required: boolean }>;
    variants?: Array<Record<string, unknown>>;
  };
}

/** Minimal fetch surface both global fetch and the plugin host HTTP satisfy. */
export type FetchImpl = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  },
) => Promise<{
  status: number;
  text: () => Promise<string>;
}>;

export interface ProdigiClientOptions {
  apiKey: string;
  env?: ProdigiEnv;
  fetchImpl: FetchImpl;
  /** Overrides the base URL entirely (e.g. for a recorded fixture server). */
  baseUrlOverride?: string;
}

export class ProdigiApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "ProdigiApiError";
  }
}

export class ProdigiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchImpl;

  constructor(opts: ProdigiClientOptions) {
    if (!opts.apiKey || !opts.apiKey.trim()) {
      throw new Error("ProdigiClient requires a non-empty apiKey");
    }
    this.apiKey = opts.apiKey.trim();
    this.baseUrl =
      opts.baseUrlOverride?.replace(/\/$/, "") ??
      PRODIGI_BASE_URLS[opts.env ?? "sandbox"];
    this.fetchImpl = opts.fetchImpl;
  }

  private headers(): Record<string, string> {
    return {
      "X-API-Key": this.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  async getQuote(req: ProdigiQuoteRequest): Promise<ProdigiQuoteResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/quotes`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(req),
    });
    const text = await res.text();
    if (res.status < 200 || res.status >= 300) {
      throw new ProdigiApiError(
        `Prodigi /quotes returned HTTP ${res.status}`,
        res.status,
        text,
      );
    }
    return JSON.parse(text) as ProdigiQuoteResponse;
  }

  async getProduct(sku: string): Promise<ProdigiProductResponse> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/products/${encodeURIComponent(sku)}`,
      { method: "GET", headers: this.headers() },
    );
    const text = await res.text();
    if (res.status < 200 || res.status >= 300) {
      throw new ProdigiApiError(
        `Prodigi /products/${sku} returned HTTP ${res.status}`,
        res.status,
        text,
      );
    }
    return JSON.parse(text) as ProdigiProductResponse;
  }
}
