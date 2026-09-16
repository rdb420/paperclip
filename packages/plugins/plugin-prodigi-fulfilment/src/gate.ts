// TD-PRINT-FOOL-A3 Economic-gate confirmation logic.
//
// This module extracts the A1 / A2 / A7 figures from an authenticated Prodigi
// quote and evaluates them against the operator-approved gate thresholds. It is
// a CONFIRMATION check only: it reports whether captured actuals stay inside the
// envelope the Economic gate was approved on. It does not authorize spend, place
// orders, or re-approve anything.

import type { ProdigiQuote, ProdigiQuoteResponse } from "./prodigi-client.js";

/** Ceilings above which the Economic gate flips negative (TAR-24 / TAR-26). */
export interface GateThresholds {
  currency: string;
  /** A1 ceiling: true production (unit cost) must not exceed this. */
  maxUnitCost: number;
  /** A2 ceiling: outbound freight must not exceed this. */
  maxShipping: number;
}

/** Defaults taken verbatim from TAR-26. */
export const GATE_THRESHOLDS: Record<string, GateThresholds> = {
  AUD: { currency: "AUD", maxUnitCost: 16.49, maxShipping: 12.0 },
  USD: { currency: "USD", maxUnitCost: 11.86, maxShipping: 8.63 },
};

export interface CapturedFigures {
  /** A1 — unframed giclée wholesale unit cost. */
  unitCost: { amount: number; currency: string } | null;
  /** A2 — outbound freight for this destination. */
  shipping: { amount: number; currency: string } | null;
  /** A7 — packaging treatment, derived from the quote line items/attributes. */
  packaging: { bundledInUnitPrice: boolean; note: string };
  /** Which Prodigi lab actually fulfils (confirms AU facility when countryCode === "AU"). */
  fulfillmentLocation: { countryCode: string; labCode: string } | null;
  sku: string | null;
  shippingMethod: string | null;
  destinationCountryCode: string;
}

function parseMoney(amount: string): number {
  const n = Number.parseFloat(amount);
  if (Number.isNaN(n)) throw new Error(`Unparseable money amount: ${amount}`);
  return n;
}

/**
 * Pull the first quote out of a Prodigi quote response and reduce it to the
 * figures the gate cares about. `destinationCountryCode` is echoed from the
 * request because the response does not restate it.
 */
export function captureFigures(
  response: ProdigiQuoteResponse,
  destinationCountryCode: string,
): CapturedFigures {
  const quote: ProdigiQuote | undefined = response.quotes?.[0];
  if (!quote) {
    return {
      unitCost: null,
      shipping: null,
      packaging: {
        bundledInUnitPrice: true,
        note: "No quote returned; packaging treatment unknown.",
      },
      fulfillmentLocation: null,
      sku: null,
      shippingMethod: null,
      destinationCountryCode,
    };
  }

  const line = quote.items?.[0];
  const shipment = quote.shipments?.[0];

  // A7 — Prodigi returns unit cost inclusive of standard packaging; a rigid
  // mailer/tube is not itemized as its own cost line. Surface any packaging
  // signal from attributes so a human can confirm rather than assume.
  const attrs = line?.attributes ?? {};
  const packagingSignal = Object.entries(attrs).find(([k, v]) =>
    /pack|tube|mailer|box|wrap/i.test(`${k} ${v}`),
  );
  const packaging = packagingSignal
    ? {
        bundledInUnitPrice: true,
        note: `Packaging-related attribute present (${packagingSignal[0]}: ${packagingSignal[1]}); no separate packaging cost line in the quote — treat as bundled into unit price. Confirm with Prodigi if a rigid tube is a chargeable upgrade for this SKU.`,
      }
    : {
        bundledInUnitPrice: true,
        note: "Quote returns no separate packaging cost line; unit cost is inclusive of standard flat/rigid packaging. Confirm rigid mailer/tube treatment with Prodigi for the chosen SKU.",
      };

  return {
    unitCost: line
      ? { amount: parseMoney(line.unitCost.amount), currency: line.unitCost.currency }
      : null,
    shipping: quote.costSummary?.shipping
      ? {
          amount: parseMoney(quote.costSummary.shipping.amount),
          currency: quote.costSummary.shipping.currency,
        }
      : null,
    packaging,
    fulfillmentLocation: shipment?.fulfillmentLocation ?? null,
    sku: line?.sku ?? null,
    shippingMethod: quote.shipmentMethod ?? null,
    destinationCountryCode,
  };
}

export type GateStatus = "holds" | "flips_negative" | "indeterminate";

export interface GateEvaluation {
  status: GateStatus;
  currency: string;
  thresholds: GateThresholds | null;
  unitCost: number | null;
  shipping: number | null;
  unitCostBreached: boolean;
  shippingBreached: boolean;
  reasons: string[];
  /** Explicit reminder that this evaluation does not authorize anything. */
  disclaimer: string;
}

const NON_AUTHORIZATION_DISCLAIMER =
  "Confirmation checkpoint only. This evaluation reflects captured Prodigi actuals against the operator-approved gate envelope; it does not authorize spend, place an order, or re-approve the Economic gate.";

/**
 * Evaluate captured figures against the gate thresholds. Thresholds are picked
 * by the captured currency; callers may pass an explicit override.
 */
export function evaluateGate(
  figures: CapturedFigures,
  override?: GateThresholds,
): GateEvaluation {
  const currency = figures.unitCost?.currency ?? figures.shipping?.currency ?? "";
  const thresholds = override ?? GATE_THRESHOLDS[currency] ?? null;
  const reasons: string[] = [];

  if (!thresholds) {
    reasons.push(
      currency
        ? `No gate thresholds defined for currency ${currency}; quote in AUD or USD, or pass an explicit threshold override.`
        : "Quote returned no priced line items; cannot evaluate the gate.",
    );
    return {
      status: "indeterminate",
      currency,
      thresholds: null,
      unitCost: figures.unitCost?.amount ?? null,
      shipping: figures.shipping?.amount ?? null,
      unitCostBreached: false,
      shippingBreached: false,
      reasons,
      disclaimer: NON_AUTHORIZATION_DISCLAIMER,
    };
  }

  const unitCost = figures.unitCost?.amount ?? null;
  const shipping = figures.shipping?.amount ?? null;

  if (unitCost === null || shipping === null) {
    reasons.push("Quote is missing unit cost and/or shipping; cannot confirm the gate.");
    return {
      status: "indeterminate",
      currency,
      thresholds,
      unitCost,
      shipping,
      unitCostBreached: false,
      shippingBreached: false,
      reasons,
      disclaimer: NON_AUTHORIZATION_DISCLAIMER,
    };
  }

  const unitCostBreached = unitCost > thresholds.maxUnitCost;
  const shippingBreached = shipping > thresholds.maxShipping;

  if (unitCostBreached) {
    reasons.push(
      `A1 unit cost ${currency} ${unitCost.toFixed(2)} exceeds the ${currency} ${thresholds.maxUnitCost.toFixed(2)} production ceiling.`,
    );
  } else {
    reasons.push(
      `A1 unit cost ${currency} ${unitCost.toFixed(2)} is within the ${currency} ${thresholds.maxUnitCost.toFixed(2)} production ceiling.`,
    );
  }
  if (shippingBreached) {
    reasons.push(
      `A2 freight ${currency} ${shipping.toFixed(2)} exceeds the ${currency} ${thresholds.maxShipping.toFixed(2)} freight ceiling.`,
    );
  } else {
    reasons.push(
      `A2 freight ${currency} ${shipping.toFixed(2)} is within the ${currency} ${thresholds.maxShipping.toFixed(2)} freight ceiling.`,
    );
  }

  return {
    status: unitCostBreached || shippingBreached ? "flips_negative" : "holds",
    currency,
    thresholds,
    unitCost,
    shipping,
    unitCostBreached,
    shippingBreached,
    reasons,
    disclaimer: NON_AUTHORIZATION_DISCLAIMER,
  };
}
