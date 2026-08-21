# Remito — Classic Argentine Form Layout — Design

Date: 2026-08-13
Status: Approved by user (conversation 2026-08-13: classic form look + keep money content + new fiscal fields)

## Problem

The user wants the remito PDF to look like the classic Argentine remito form
(reference: a printed "Remito R" sample): a fully framed document with a
central document-letter box, an emitter/document header split left/right,
horizontal full-width bands for CLIENTE / CONDICIONES, and a ruled items
table with vertical column separators.

The current remito (generateFacturaPDF, accounting-grade redesign of
2026-08-11) is an open monochrome layout: no outer frame, no letter box, no
band rules, table without vertical rules.

## Decisions (from scope conversation)

1. **Keep the money content.** The remito is the app's collections document.
   The classic *layout* is adopted; prices, SALDO PENDIENTE, and payment
   history stay. (Option "exact clone without prices" was rejected.)
2. **Letter X, not R / Cód. 91.** A self-generated PDF carrying "R" + AFIP
   document code 91 would imitate a fiscal document that legally requires an
   authorized print shop (CAI) or electronic authorization. The letter box
   prints **X** with the legend "Documento no válido como comprobante
   fiscal" — consistent with the existing footer disclaimer.
3. **Add two emitter fields** shown on the reference form and missing from
   `organizations`: `ingresos_brutos` and `inicio_actividades`. Both TEXT,
   nullable, editable in the "Datos fiscales y de cobro" settings card.

## Layout (top to bottom)

All inside `generateFacturaPDF` (lib/pdf.ts). Monochrome house style
(MONO/TYPE helpers) unchanged — the classic form is expressed with rules and
frames, not new colors.

1. **Outer frame**: full content-width rectangle around the header area and
   bands (the classic form look). Table and payment history get their own
   frames (see 5/6). Footer stays outside the frame, unchanged.
2. **Header, three zones**:
   - Left: logo (existing behavior) + company name bold + dirección + tel.
   - Center: **letter box** — bordered square straddling the header's top
     edge with a large bold **X** and, under it in fine print, "Documento
     no válido como comprobante fiscal".
   - Right: `REMITO` title, `Nº {numeroFactura}`, `Fecha: {emisión}`, plus
     `Operación: {fechaOperacion}` when present. Below, one small line
     each, only when present: `CUIT: …`, `Ingresos brutos: …`,
     `Inicio actividades: …`, and the IVA condition in caps (e.g.
     `IVA RESPONSABLE INSCRIPTO`). Domicilio fiscal stays in the left
     zone (existing conditional line).
3. **CLIENTE band** (full-width, rule above and below): client name bold,
   then domicilio / tel / email (existing conditional lines). Right half of
   the band: `CUIT/DNI: …` when present, and the origin reference —
   `ORDEN: {código} — {dispositivo}` or `VENTA: V…` — replacing the
   reference block of the current layout. No client IVA-condition line (the
   app does not store it).
4. **CONDICIONES band**: the existing CONDICIONES DE PAGO block content
   (vencimiento, medios de pago, CBU/alias) rendered as a labeled band.
   Drawn only when at least one field is present (unchanged rule — nothing
   is invented for empty orgs). No TRANSPORTE band (no data in the model).
5. **Items table, framed**: existing columns CANT | DESCRIPCIÓN | PRECIO |
   SUBTOTAL, now inside a frame with vertical column rules and a ruled
   header row. No CÓDIGO / ENVASE columns (no data). Continuation pages
   redraw frame + header row (existing startContinuationPage mechanism).
6. **Money + payments**: unchanged content — subtotal/IVA/total rows,
   SALDO PENDIENTE protagonist bar, HISTORIAL DE PAGOS with running
   balance — with the payments table framed like the items table.
   "Recibí conforme" (orden-sourced only) and PAGADO badge unchanged.
7. **Footer**: unchanged (disclaimer + Página N de M) on every page.

Degradation guarantee: every new header line is conditional on its field —
an org with no fiscal data gets the same information as today, in the new
frame.

## Data changes

- **Migration 296** (number tentative — assigned at merge; 294 is reserved
  by open PR #283, 295 is merged): `organizations.ingresos_brutos TEXT`,
  `organizations.inicio_actividades TEXT`, both nullable, with COMMENTs;
  rollback file `rollback/296_rollback.sql`. Applied manually per repo
  convention (scripts/db-run.mjs, dry-run first).
- **Settings card** "Datos fiscales y de cobro": two new text inputs
  (Ingresos brutos, Inicio de actividades). Pre-migration degradation via
  lib/db-errors.ts (isMissingColumnError) as done for the 295 fields —
  note the 42703-on-select vs PGRST204-on-write distinction.
- **PDF route**: thread both fields into FacturaPDFData as
  `ingresosBrutosEmpresa` / `inicioActividadesEmpresa` (optional).

## Testing (strict TDD)

Extend the existing pdf suites (`__tests__/lib/factura-pdf-venta.test.ts`
et al.) before implementation:

- New header lines present when fields set, absent when not.
- Letter box: X + legend text present; "R"/"91" never rendered.
- Conditional bands: CONDICIONES absent for empty org; CLIENTE band shows
  origin reference per source (orden vs venta).
- Money content preserved: saldo bar, running balance, dual dates.
- Multipage invariant unchanged (mediaBox.y + height === 842) and frame
  redrawn on continuation pages.

Known gotcha (2026-08-11 wave): layout rewrites silently drop fields —
sweep the full FacturaPDFData interface against draw sites after the
rewrite.

## Files

- `supabase/migrations/296_ingresos_brutos_inicio_actividades.sql` (+ rollback)
- Settings card component for "Datos fiscales y de cobro"
- API route(s) building FacturaPDFData
- `lib/pdf.ts` (generateFacturaPDF layout)
- `__tests__/lib/` pdf suites

## Out of scope

- TRANSPORTE band, CÓDIGO / ENVASE columns, client IVA condition, ORDEN DE
  COMPRA / COMPROBANTE fields (no backing data; not requested).
- Any change to the other PDF generators (recepción, expediente, garantía,
  nota de crédito, térmico).
- Fiscal validity: the document remains an internal X-letter remito.
