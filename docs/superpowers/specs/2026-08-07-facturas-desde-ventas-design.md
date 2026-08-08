# Design: Invoice creation entry point + invoices for POS sales

**Date:** 2026-08-07
**Status:** Approved (approach A)
**Origin:** Client report — the `/facturacion` page only lists order invoices and offers no way to create one. Creation is hidden in the order detail menu (ADMIN + REPARADO/ENTREGADO only), and POS sales cannot be invoiced at all.

## Goal

1. Add a visible "Generar factura" entry point on `/facturacion`.
2. Allow creating internal (non-fiscal) invoices from POS sales (`ventas`), sharing the same `facturas` table, numbering, and listing as order invoices.

Out of scope: fiscal/ARCA electronic invoicing (lives in `feat/facturacion-electronica-arca`), payment tracking changes, a unified `comprobantes` model.

## Current state (facts)

- `facturas.orden_id` is `UNIQUE NOT NULL` (`001_schema.sql:280`) — an invoice without an order is structurally impossible.
- `crear_factura_atomica` (current definition in `250_factura_numero_unique.sql`) requires `p_orden_id`; the JS fallback in `app/api/facturacion/generar/route.ts` mirrors it.
- `items_factura` RLS navigates `facturas → ordenes_servicio` (`053_mejoras_ventas_inventario.sql:168-176`).
- `GET /api/facturacion` uses `ordenes_servicio!inner`, structurally excluding anything not linked to an order.
- `ventas` persists a per-row IVA snapshot (`iva_neto`, `iva_monto`, `iva_tasa`, `iva_regimen`, `redondeo_monto` — migration 229). Sales can be anonymous (`cliente_id` nullable, `cliente_nombre NOT NULL`).
- Sales already have a non-fiscal receipt (PDF A4 + thermal ticket via `app/api/ventas/[id]/pdf`); that stays untouched.

## Data model (one new migration)

1. `ALTER TABLE facturas ALTER COLUMN orden_id DROP NOT NULL` — keep the existing UNIQUE constraint (Postgres allows multiple NULLs).
2. `ALTER TABLE facturas ADD COLUMN venta_id TEXT UNIQUE REFERENCES ventas(id) ON DELETE CASCADE` (nullable).
3. `CHECK ((orden_id IS NOT NULL) <> (venta_id IS NOT NULL))` — exactly one source.
4. Rewrite `items_factura` RLS policies to authorize via `facturas.organization_id` directly (column exists since migration 250) instead of joining `ordenes_servicio`.
5. New RPC `crear_factura_venta_atomica(p_venta_id, ...)` mirroring `crear_factura_atomica`: derives `organization_id` from the venta, takes the invoice number atomically, inserts `facturas` + `items_factura` in one transaction. The existing `crear_factura_atomica` signature is NOT touched, so the current JS fallback detection keeps working.

Migration number is assigned at merge time (project convention); applied manually via `scripts/db-run.mjs`.

## API

### `POST /api/facturacion/generar`

Body becomes a zod union: `{ ordenId }` XOR `{ ventaId }`. Order path is unchanged. Venta path:

- Auth: `requireAdmin()` (same as orders).
- Gates → errors:
  - venta not found / other org → 404 "Venta no encontrada"
  - `estado === 'ANULADA'` → 400 "La venta está anulada"
  - invoice already exists for the venta → 400 "Ya existe una factura para esta venta"
- Snapshot `items_venta` → `items_factura`: `tipo = 'REPUESTO'` when `inventario_id` is set, `'OTRO'` otherwise.
- IVA: copy the persisted snapshot from the venta (`iva_monto`, or 0 when null/EXENTO). Never recompute — the invoice must match the ticket the client already printed.
- `estado_pago` / `monto_abonado`: copied from the venta at creation time. Payments keep living in `pagos_venta`; venta invoices do not use `pagos_parciales`.
- Numbering: same `get_next_invoice_number` counter — one sequence for all invoices.
- JS fallback: mirror the venta path when the RPC is missing (same `isFunctionMissingError` pattern).

### `GET /api/facturacion`

Replace the `ordenes_servicio!inner` join with left joins to both `ordenes_servicio` and `ventas`; filter by `facturas.organization_id`. Response rows carry a discriminator (`origen: 'orden' | 'venta'`) plus enough source data for the list (client name, source number, link target).

### `GET /api/facturacion/[id]/pdf`

`generateFacturaPDF` learns to render venta invoices: client block from `ventas.cliente_nombre` (may be "Consumidor Final"), items from the snapshot, same layout and title otherwise.

## UI

- `/facturacion` (ADMIN only, page already admin-gated in middleware): header button **"Generar factura"** opening a modal with two tabs:
  - **Órdenes**: orders in REPARADO/ENTREGADO without an invoice, with search.
  - **Ventas**: COMPLETADA sales without an invoice, with search.
  - Selecting an item POSTs to `/api/facturacion/generar` and refreshes the list.
- List: source badge (Orden / Venta) linking to the order or sale detail.
- Sale detail (`components/ventas/venta-detail.tsx`): "Generar factura" action for ADMIN when the venta is COMPLETADA and uninvoiced — same POST.
- Order flow in `orden-detail.tsx` stays as is.

## Error handling

Venta-path messages mirror the existing order-path style (Spanish, actionable, correct status codes). Unexpected failures keep the generic 500 with server-side `console.error` detail.

## Testing (strict TDD)

API tests alongside the existing `__tests__/api/factura-*` suites:

- zod union: rejects body with both/neither of `ordenId`/`ventaId`.
- venta gates: ANULADA, duplicate invoice, cross-org 404, non-admin 403.
- IVA copied (not recomputed) from the venta snapshot; EXENTO → iva 0.
- `estado_pago`/`monto_abonado` copied from the venta.
- mixed listing returns both origins with correct discriminator.
- RPC-missing fallback path for ventas.

## Delivery

Two chained PRs (stacked-to-main):

1. **PR 1 — backend**: migration + RPC + `generar` venta path + listing change + tests.
2. **PR 2 — UI**: modal picker on `/facturacion`, list badges, venta-detail button, PDF rendering.

## Risks

- Migration/prod drift: the JS fallback pattern already exists for this reason; the venta path gets the same treatment.
- `facturas.estado_pago` can drift if a venta with pending balance receives payments after being invoiced. Accepted for slice 1: the venta remains the source of truth for collections; revisit only if clients invoice unpaid sales frequently.
