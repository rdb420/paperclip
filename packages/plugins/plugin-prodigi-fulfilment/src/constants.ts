export const PLUGIN_ID = "paperclip-prodigi-fulfilment";
export const PLUGIN_VERSION = "0.1.0";

export const TOOL_NAMES = {
  quote: "prodigi_quote",
  gateCheck: "prodigi_gate_check",
  product: "prodigi_product",
} as const;

/** Default A3 unframed giclée SKU (Enhanced Matte Art 200gsm, 29.7x42cm). */
export const DEFAULT_A3_SKU = "GLOBAL-FAP-A3";

export interface ProdigiPluginConfig {
  /** secret_ref binding resolved at runtime to the X-API-Key value. */
  apiKey?: unknown;
  /** "live" | "sandbox" */
  environment?: string;
  /** Advanced base-URL override. */
  baseUrlOverride?: string;
}

export const DEFAULT_CONFIG: Required<Pick<ProdigiPluginConfig, "environment">> = {
  environment: "live",
};
