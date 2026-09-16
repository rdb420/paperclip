# @paperclipai/plugin-prodigi-fulfilment

Headless connector plugin that gives agents authenticated access to the
[Prodigi Print API v4.0](https://www.prodigi.com/print-api/docs/reference/) for
**quote capture** and **Economic-gate confirmation** — the capability
`TAR-26` / `TD-PRINT-FOOL-A3` needs.

It is **quote/product only**. It never places an order and never spends. Order
placement is deliberately not implemented.

## What it exposes

Three agent tools (auto-namespaced by the host as `paperclip-prodigi-fulfilment:<name>`):

| Tool | Purpose |
|------|---------|
| `prodigi_quote` | Authenticated quote for a `sku` shipped to a `destinationCountryCode`. Returns unit cost (A1), freight (A2), fulfilment lab, and packaging treatment (A7). |
| `prodigi_gate_check` | Captures the A3 giclée SKU (default `GLOBAL-FAP-A3`) in the **AU** and **US** markets and evaluates the operator-approved gate ceilings. Confirmation only — authorizes nothing. |
| `prodigi_product` | Product details (dimensions, print areas, attributes) for a SKU. |

## Configuration

Instance settings (`Company Settings → Instance → Plugins → Prodigi Fulfilment`):

| Field | Notes |
|-------|-------|
| `apiKey` | **Secret reference (optional).** Paste your Prodigi `X-API-Key` or pick a saved Paperclip secret. Stored as a `secret_ref`, never in plain config. If unset, the worker falls back to `PRODIGI_X_API_KEY` from the server environment (single-tenant, trusted-local convenience — the phase-a compose injects it). |
| `environment` | `live` (default) or `sandbox`. Quotes never charge in either. A live key is rejected by the sandbox host and vice-versa. |
| `baseUrlOverride` | Advanced: override the base URL entirely (e.g. a fixture server). |

The key is resolved at call time via `ctx.secrets.resolve` and used only as the
`X-API-Key` header. It is never logged or persisted.

## The gate math (TD-PRINT-FOOL-A3)

The Economic gate was operator-approved (TAR-24) on planning assumptions. It
flips **negative** if true production exceeds **A$16.49 / US$11.86** or freight
exceeds **A$12 / US$8.63**. `prodigi_gate_check` and `src/gate.ts` encode exactly
those ceilings and report `holds` / `flips_negative` / `indeterminate` with a
hard-coded non-authorization disclaimer.

## Build / test

```bash
pnpm --filter @paperclipai/plugin-prodigi-fulfilment typecheck
pnpm --filter @paperclipai/plugin-prodigi-fulfilment test
pnpm --filter @paperclipai/plugin-prodigi-fulfilment build
```

`src/prodigi-client.ts` and `src/gate.ts` are host-independent (injected
`fetchImpl`), so the pricing and gate logic are unit-tested without a running
host. The worker wires them to `ctx.http.fetch` + `ctx.secrets.resolve`.

## Relationship to the existing `prodigi-fulfilment` runtime plugin

An earlier `prodigi-fulfilment` was installed at runtime as a headless webhook
ingester with no quote tool — which is why `TAR-26` stayed blocked. This package
is the source-controlled connector that actually exposes quote capture. Install
it (local-path or npm) so `@ops-fulfilment` can call `prodigi_gate_check`
directly.
