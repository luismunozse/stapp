# Wholesale Batch (Lote) on Multi-Device Reception — Design

**Date:** 2026-08-04
**Status:** Approved by user (design), pending implementation plan
**Depends on:** `feat/recepcion-multiple` (unmerged, 37 commits) and `feat/cobro-en-entrega` (unmerged) landing on `main` first.

## Problem

Wholesale repair clients drop off several devices at once (e.g. 5 phones) and negotiate a price for the whole batch. Today that means creating N separate orders one by one, and there is no way to express a batch price: the sum of 5 individual orders created on different days is priced differently than 5 devices negotiated together.

Each device still needs its own diagnosis and repair tracking, so devices cannot be collapsed into a single free-text order.

## Decision: extend Reception, do not nest devices inside an order

`feat/recepcion-multiple` already ships the hard 70%: one form capturing one client + N devices + one signature, creating **N regular orders grouped under a `recepciones` row** (a document, not a lifecycle entity), gated to Profesional/Pro via `plans.feature_flags.recepcion_multiple`.

Because each device is a real order, per-device diagnosis, state machine, labels, tracking, warranties, and (fallback) individual delivery all work with zero changes. The alternative — a child `orden_equipos` table — was rejected: exploration found ~15 call sites that assume one device per order (order detail, delivery dialog, thermal/PDF receipts, labels, public tracking, kiosk, warranties, WhatsApp messages, lists, dashboard), and it would conceptually compete with the reception model that already exists.

What reception does NOT solve today, and what this change adds:

1. **Batch discount** on the reception total.
2. **Batch view**: one screen showing the batch's devices, progress, and totals.
3. **Batch delivery with a single charge**, reusing the cobro-en-entrega flow.

## 1. Data model

Migration on `recepciones` only; `ordenes_servicio` is untouched.

| Column | Type | Notes |
| --- | --- | --- |
| `descuento_tipo` | `TEXT NULL` (`'porcentaje'` \| `'monto'`) | NULL = no discount |
| `descuento_valor` | `NUMERIC NULL` | `> 0` when `descuento_tipo` is set; `<= 100` when `porcentaje` |

Derived values (never stored):

- `subtotal` = sum of the linked orders' `presupuesto` (quote stage) or `costo_final` (delivery stage).
- `total lote` = `subtotal − descuento` (floored at 0).
- Per-order prorated share = order amount × (total / subtotal), used for cash-register attribution, commissions, and partial pickup. Rounding remainder is assigned to the largest share (first index on ties) so shares always sum exactly to the charged total and no share can go negative. *(Amended: the original "last order" rule could drive a small/zero share negative.)*

A `CHECK` constraint enforces the tipo/valor pairing at the DB level.

## 2. Batch (reception) detail view

New page `app/(dashboard)/ordenes/recepcion/[id]` (or equivalent under the existing recepcion route group):

- Header: client, reception code, date, signature status.
- Device list: each linked order with device summary, estado badge, and presupuesto/costo — e.g. "3 of 5 repaired" at a glance. Each row links to the order detail.
- Totals card: subtotal, discount (type + value), batch total.
- Discount editing: inline on this view, allowed while the batch is undelivered; requires the same role that can edit order pricing today.
- Entry points: from the reception-created modal, and from any member order's detail (link back to its `recepcion_id` batch).

## 3. Batch delivery — single charge

Button **"Entregar lote"** on the batch view:

- Enabled only when every **eligible** linked order is in `REPARADO`. Excluded from the batch action (they exit the lote through the individual flow or stay closed): orders already delivered (`ENTREGADO`, `ENTREGADO_SIN_REPARACION`, `ENTREGADO_SIN_COBRO`) and orders in `CANCELADO`, `SIN_REPARACION`, or `SIN_FALLA_DETECTADA`. One shared exclusion list (single module) is consumed by the batch view, the API, and the RPC — no hand-synced copies.
- The batch view's totals card shows: subtotal (all members), discount, **total del lote** (all members, discounted), **ya cobrado** (net amount already charged on individually-delivered members), and **pendiente de cobro** (what the batch action will charge).
- Opens the existing delivery+charge dialog semantics once for the whole batch: confirm final costs per device, apply the discount, charge `sum(costo_final) − descuento` in one operation.
- On confirm, each order transitions to `ENTREGADO` through the existing state machine (no direct status writes — same rule as #241/#242).
- **One charge operation for the operator.** Internally the amount is persisted as prorated `cobros_orden` rows per order (the cash-register day view shows one line per device, summing to the charged total) so per-order reporting, commissions, and estado_cobro keep working. Each order's discount share is recorded as `descuento_cobro` so no phantom receivable remains. *(Amended: the original "one cash-register movement" wording described the UX, not the storage.)*
- **Partial pickup fallback (amended):** the existing single-order delivery flow keeps working for a batch member and charges that order's **full individual price** (it is batch-unaware). The subsequent batch delivery settles the difference: the lote total is always computed over **all** members' costs, the net amount already charged on delivered members is subtracted, and only the remainder (floored at 0) is charged, prorated across the pending orders. The negotiated lote total therefore holds regardless of pickup order; per-order discount attribution skews toward the later-delivered orders, which is accepted. A member delivered as `ENTREGADO_SIN_COBRO` counts as fully charged (its write-off is never recovered from the remaining orders), and with a percentage discount its cost still sits in the discount base — the customer nets that member's discount share as an extra reduction, which is the accepted reading of "the whole batch got X% off". The money lines (subtotal, total del lote, ya cobrado, pendiente) are computed over non-excluded members only; excluded members still appear in the device list.
- **Batch delivery ordering invariant:** each order's charge is registered while the order is still `REPARADO`, and the estado flips to `ENTREGADO` afterwards inside the same transaction — otherwise the charge RPC's fiado auto-settlement credits the customer's account with the full charged amount (phantom store credit).
- **Stock:** batch delivery consumes each order's stock reservations (`consumir_reservas_orden`) exactly like the individual flow, best-effort with surfaced warnings.

Failure handling: creation already runs in one transaction (`crear_recepcion_multiple` RPC pattern); batch delivery must be equally atomic — one RPC/transaction that validates states, records the payment, and transitions all orders, or rolls back entirely.

## 4. Premium gating and discoverability

No new gating and **no configuration toggle**:

- Feature flag `recepcion_multiple` (Profesional/Pro) already gates the reception form (server: `hasPlanFeature`; client: `useHasFeature`; blocked page: `FeatureLockedView`). The batch view, discount fields, and batch-delivery API inherit the same flag — server-side checks included (403 `FEATURE_REQUIRED`), since batch endpoints are new surface.
- Discoverability: the "Recepción múltiple" button lives on the orders screen. On Free plan it renders with a lock and routes to the plans upsell (same pattern as cotizaciones). A config toggle was considered and rejected: it adds a step without adding control anyone asked for; plan entitlement is the only real switch.

## 5. Out of scope (YAGNI)

- No batch-level estado or lifecycle — the reception stays a document; progress is derived from member orders.
- No partial-batch charge UI beyond the existing per-order delivery flow.
- No changes to labels, tracking, kiosk, warranties, or WhatsApp — they keep operating per order.
- No org-level toggle in configuración.

## Sequencing

1. Land `feat/recepcion-multiple` (PR + migrations 278–279).
2. Land `feat/cobro-en-entrega` (current branch).
3. Implement this design on a new branch on top of `main`.

## Testing

- Unit: discount math (porcentaje/monto, floor at 0, proration incl. rounding remainder on the last order).
- API: batch delivery RPC — happy path, mixed states rejected, atomic rollback, feature-flag 403, prorated cash/commission attribution.
- E2E (Playwright, existing authenticated suite): create batch reception → set discount → mark all repaired → deliver batch → orders ENTREGADO + single cash movement.
- Strict TDD mode is active for this project: tests first per `strict-tdd.md`.
