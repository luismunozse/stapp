# Electronic Invoicing (ARCA/AFIP) — Slice 1 — Design

**Date**: 2026-07-23
**Status**: Approved by Luis (pending spec review)

## Goal

Let an Argentine organization on the **Profesional** plan issue AFIP/ARCA electronic
invoices (**Factura B or C**) from an already-closed POS sale, using a third-party
provider (**TusFacturasAPP**) with the organization's **own credentials** (BYO model).
The feature is **opt-in, off by default** — no behavior change for any org until an
admin enables and connects it.

STApp is only the integrator: it never emits under STApp's own CUIT, so STApp carries
**zero fiscal responsibility** and the developer's personal tax status is irrelevant.

## Non-goals (deliberately out of scope for Slice 1)

- Credit/debit notes (notas de crédito/débito).
- Factura A (only B/C in this slice).
- Automatic emission — emission is always a manual, explicit action.
- Invoicing STApp's own SaaS subscription (that would require STApp to be tax-registered — separate concern).
- Providers other than TusFacturasAPP. **Afip SDK stays documented as the fallback**, behind the same interface, not implemented here.
- Asynchronous emission and the provider webhook — Slice 1 uses instantaneous individual emission, so the CAE returns synchronously (see §5/§6).
- Fiscal documents for anything other than a POS sale (orders/quotes are untouched).
- Centralized/reseller model (STApp holding a master account). The `FacturacionProvider` interface leaves the door open to add it later without rework.

## Testing / homologación — RESOLVED

TusFacturasAPP provides a **free DEV account (30 days, renewable)** that emits **test
comprobantes** (A/B/C/E/M/MiPyME) with a response structure **identical to production but
without CAE and QR**, and **without connecting to ARCA** — i.e. no real fiscal document is
ever produced. This is the safe test mode the spike was worried about, and Luis's current
free account already provides it.

Consequences:
- The earlier "might emit a real invoice while testing" risk is **eliminated**.
- The **Afip SDK fallback is no longer needed** as a contingency. It stays documented
  behind the interface only as a provider-portability option.
- **No X.509 certificates or WSAA** live in STApp: the org configures its CUIT and ARCA
  connection **inside TusFacturasAPP** (TusFacturas absorbs that layer). STApp only ever
  stores the three API credentials.

**Spike (Task 1) is reduced to**: emit one Factura B and one Factura C against the DEV
account, confirm the response shape (`numero`, `estado`, `pdf`), and validate that
`TusFacturasProvider` parses it. No blocking unknowns remain.

## Architecture

### 1. Gating — two layers (mirrors the existing pattern)

Migration 275 already establishes the rule: an **org preference** is a column on
`organizations`; **commercial gating** lives in `plans.feature_flags`. We keep both
separate.

- **Commercial gate** (who *may* have it): `plans.feature_flags.facturacion_electronica`
  on the Profesional plan **AND** `organizations.pais = 'AR'`. Controls visibility of the
  whole feature. Hard gate, server-derived.
- **Org preference** (opt-in): new column
  `organizations.facturacion_electronica_habilitada BOOLEAN NOT NULL DEFAULT false` —
  calqued from `vendedores_administran_inventario`.
- **Effective "can emit"** = commercial gate passes **AND** toggle on **AND** valid
  credentials connected. Any missing → no emission (fails closed).

### 2. Provider abstraction — `lib/facturacion/`

- `FacturacionProvider` interface:
  - `emitir(input: EmitirInput): Promise<ComprobanteResult>`
  - `consultarEstado(ref): Promise<EstadoResult>`
- `TusFacturasProvider` — the only implementation in this slice. Calls
  `https://www.tusfacturas.app/app/api/v2/facturacion/nuevo` with the three credentials
  (`apitoken`, `apikey`, `usertoken`) in the payload.
- `AfipSdkProvider` — documented stub only (fallback), not implemented.
- A small factory resolves the provider per org (always TusFacturas in Slice 1).
- Types (`EmitirInput`, `ComprobanteResult`, receptor/emisor shapes) live in
  `lib/facturacion/types.ts` so route handlers stay thin.

### 3. Credentials / connection (BYO — security-critical)

The three secrets **must never reach the frontend** and must never be added to the
`app/api/configuracion` GET payload (which returns all org columns to the client).

- Storage: dedicated table `facturacion_credenciales` (one row per org), secrets stored
  **encrypted at rest**. Kept out of the broadly-selected `organizations` row on purpose.
  - Columns: `organization_id` (unique), `apitoken_enc`, `apikey_enc`, `usertoken_enc`,
    `punto_venta`, `estado` (`no_conectado | conectado | error`), `updated_at`.
- Encryption: reuse an existing crypto helper if one exists; otherwise add
  `lib/facturacion/crypto.ts` (AES-256-GCM with a key from env). Confirmed during apply.
- No certificates in STApp: the org sets up its CUIT and ARCA connection inside the
  TusFacturasAPP account; STApp stores only the three API credentials.
- Endpoint `app/api/facturacion-electronica/credenciales` (ADMIN only):
  - `PUT` — **write-only** for secrets; accepts the three values, encrypts, stores,
    optionally validates against the provider, sets `estado`.
  - `GET` — returns **status only** (`estado`, `punto_venta`, `updated_at`) — never the
    secret values.
- Namespacing note: feature endpoints live under `app/api/facturacion-electronica/*`
  because `app/api/facturacion/*` is the SaaS billing surface — do not collide.

### 4. Data — migration `296_facturacion_electronica.sql`

- `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS facturacion_electronica_habilitada BOOLEAN NOT NULL DEFAULT false;` + `COMMENT ON COLUMN` (org preference, not plan gating).
- `CREATE TABLE IF NOT EXISTS facturacion_credenciales (...)` as in §3.
- `CREATE TABLE IF NOT EXISTS comprobantes_fiscales (...)`:
  - `id`, `organization_id`, `venta_id` (FK to the POS sale), `tipo` (`B|C`),
    `punto_venta`, `numero`, `cae`, `cae_vencimiento`,
    `estado` (`pendiente | emitido | rechazado`), `pdf_url`,
    `receptor_doc_tipo`, `receptor_doc_nro`, `receptor_condicion_iva`,
    `total`, `provider` (`tusfacturas`), `provider_response` (jsonb), `error_msg`,
    `created_at`, `updated_at`.
  - Unique guard so a sale cannot be double-emitted: partial unique on
    `(venta_id)` where `estado = 'emitido'`.
- Seed/patch the `facturacion_electronica` feature flag onto the Profesional plan.
- Idempotent, banner comment, following the conventions of 265/274/275.

### 5. Emission (POS, manual)

- Button **"Emitir factura"** on an already-closed POS sale, visible only when the
  effective "can emit" is true.
- Uses the provider's **instantaneous individual** emission mode: CAE, `numero` and PDF
  come back in the same response, so no callback is needed for the happy path.
- The server route `app/api/facturacion-electronica/emitir`:
  1. Re-checks the full gate server-side (never trust the client).
  2. Derives `tipo` (B/C) from the emisor's IVA regime (`organizations.iva_regimen`) and
     the receptor's IVA condition. Exact matrix pinned in the spec.
  3. Inserts a `comprobantes_fiscales` row as `pendiente`.
  4. Calls `provider.emitir(...)`; on success stores CAE + `numero` + `pdf_url` and sets
     `emitido`; on provider rejection sets `rechazado` + `error_msg`.
  5. Is idempotent per sale (the partial unique guard + pre-check prevents duplicates),
     reusing the existing atomic-emission patterns from the non-fiscal invoice code.
- The receipt/PDF is surfaced as a link (provider-generated), not re-rendered by STApp.

### 6. Webhook — `app/api/tusfacturas/webhook` (deferred / out of Slice 1)

With instantaneous individual emission (§5) the CAE arrives synchronously, so **Slice 1
does not need a webhook**. It is kept in the design only as the hook for a future
asynchronous emission mode. If ever added it must authenticate via a shared
secret/signature, update the matching `comprobantes_fiscales` row, and be idempotent on
repeated deliveries.

### 7. Security summary

- Enforcement is server-side per endpoint; feature visibility (button/section) is UX only.
- Credentials encrypted at rest, ADMIN-only write, **never returned** to the frontend.
- Default off + no credentials → no emission anywhere (fails closed).
- Webhook authenticated; emission route re-validates the gate independently.
- No STApp CUIT ever emits — no fiscal exposure for STApp.

## Delivery — chained PRs (stacked-to-main)

0. **Spike (short, non-blocking)**: emit a Factura B and C against the DEV account
   (§ Testing / homologación) and validate `TusFacturasProvider` parsing. TusFacturas is
   confirmed for Slice 1; Afip SDK is not needed.
1. **PR1 — Foundations (invisible)**: migration 296 + `FacturacionProvider` interface +
   `TusFacturasProvider` + crypto helper + types + unit tests. Flag defaults false, no UI
   → identical behavior for every org. Safe to deploy before the migration is applied
   because every path fails closed.
2. **PR2 — Settings & connection**: Configuración section (commercial-gated visibility) +
   opt-in toggle + write-only credentials endpoint + connection status.
3. **PR3 — Emission**: "Emitir factura" button in POS + emission route (instantaneous
   individual mode) + `comprobantes_fiscales` persistence + PDF link. Webhook is out of
   Slice 1 (see §6).

Deploy order: merge PR1 → apply migration 296 → merge PR2 → merge PR3.

## Testing

- **Gate helper**: Profesional+AR+toggle-on+creds → can emit; any missing → blocked.
- **Credentials endpoint**: ADMIN-only; `GET` never leaks secrets; `PUT` encrypts and
  round-trips only status.
- **Provider**: `TusFacturasProvider.emitir` maps a sale to the provider payload and
  parses success/rejection (mocked HTTP; no real emission in tests).
- **Emission route**: happy path stores CAE + `emitido`; rejection stores `rechazado` +
  `error_msg`; double-emit on the same sale is prevented by the unique guard.
- **Tipo derivation**: B/C matrix table-tested against emisor regime × receptor condition.
