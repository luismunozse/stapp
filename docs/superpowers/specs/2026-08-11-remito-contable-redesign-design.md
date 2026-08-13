# Remito — Accounting-Grade Redesign — Design

Date: 2026-08-11
Status: Approved by user (conversation 2026-08-11: expert-accounting structure + two slices)

## Problem

The current REMITO (generateFacturaPDF, monochrome since the phase-1/2 redesign)
is visually clean but poor as a collections document:

- The TOTAL bar is the visual protagonist; for a partially-paid document the
  actionable number is the OUTSTANDING BALANCE (saldo pendiente).
- No complete issuer identity (no CUIT, IVA condition, fiscal address) and no
  structured receiver identity (DNI/CUIT).
- No payment instructions (due date, accepted methods, CBU/alias) — a
  collections document that does not say how to pay does not collect.
- Payment history shows isolated payments with no running balance.
- One date only (no emission vs operation distinction).
- No "Recibí conforme" signature block (the one element that would make the
  document work as an actual delivery remito when it accompanies a handover).

Conceptual note (recorded, no action): with prices + payment state this
document is technically a nota de venta / account statement, not a strict
remito (delivery note). The user keeps the REMITO name; the redesign makes it
function properly as a collections document.

## Scope — two slices

### Slice 1 — PDF restructure (existing data + conditional blocks)

All inside `generateFacturaPDF` (lib/pdf.ts) + tests. No schema changes.
Monochrome house style unchanged (MONO/TYPE/pdf-style helpers; the single
`MONO.totalBg` fill moves to the SALDO bar).

New layout, top to bottom:

1. **EMISOR block** (top-left): company name bold; below it, conditionally
   rendered when the org data exists: CUIT, condición IVA, domicilio fiscal.
   (Fields arrive in Slice 2 — Slice 1 renders them if present in the data
   interface, so Slice 2 needs no PDF changes.)
2. **Doc-title block** (top-right, unchanged): REMITO + number + dates —
   now TWO dates: `Emisión` (today) and `Operación` (venta/orden date, which
   already exists in the source rows).
3. **RECEPTOR block**: client name + phone (existing) + DNI/CUIT when present
   on the client record (field exists or arrives in Slice 2 — conditional).
4. Reference line: Orden/Venta number + vendedor (existing).
5. **Items table** (existing columns; no invented SKU/bonif columns unless the
   `items_factura` schema already carries them — verify at plan time).
6. **Money block** (right-aligned rows): Subtotal, Descuento, Redondeo, TOTAL
   (plain bold row, no fill), `Pagado a cuenta`, then **SALDO PENDIENTE** on
   the `MONO.totalBg` bar at `TYPE.total` — the bar moves from TOTAL to SALDO.
   When fully paid, the bar shows `SALDO $ 0` and the PAGADO badge sits beside
   it (drawOutlinedBadge, unchanged wording).
7. **CONDICIONES DE PAGO block** (conditional — renders when any of the
   Slice-2 fields exist): vencimiento, medios de pago, CBU/alias.
8. **HISTORIAL DE PAGOS** with a new right-most column: `Saldo` (running
   balance after each payment). Pagination behavior unchanged.
9. **Recibí conforme** block: signature line + `Aclaración:` line, drawn only
   when the remito is orden-sourced (accompanies a physical handover);
   venta-sourced remitos skip it.
10. Footer unchanged (non-fiscal disclaimer + Página N de M).

Tests: extend `__tests__/lib/factura-pdf-venta.test.ts` — saldo bar text,
running-balance column values, dual dates, conditional blocks present/absent
per fixture, recibí-conforme only on orden-sourced.

### Slice 2 — data + configuration

- Migration: `organizations` gains `cuit`, `condicion_iva`, `domicilio_fiscal`
  (if `direccion` is not enough), `cbu_alias`, `medios_pago_texto`,
  `plazo_pago_dias` (nullable, all optional).
- Configuración UI: new "Datos fiscales y de cobro" section in the existing
  org settings form.
- API routes that build FacturaPDFData pass the new org fields + client
  DNI/CUIT through to the PDF.
- Client DNI/CUIT: verify the `clientes` table — if a document field already
  exists, surface it; if not, add it in this migration and to the client form.
- Migration applied manually per repo convention (scripts/db-run.mjs, dry-run
  first).

## Out of scope

- Fiscal invoicing (ARCA/TusFacturas) — separate initiative, untouched.
- Renaming the document again or splitting into remito/recibo/estado de
  cuenta — recorded as a conceptual note only.
- SKU/bonificación line columns if the schema lacks them (candidate slice 3).
- Other PDF documents.
