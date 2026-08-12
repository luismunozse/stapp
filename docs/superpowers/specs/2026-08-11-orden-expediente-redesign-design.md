# Orden Comprobante — "Expediente" Redesign (Dirección D) — Design

Date: 2026-08-11
Status: Approved by user (mockups: `.tmp-preview/mockups/orden-maximal.html` — the design target; direction D chosen over A/B/C in `.tmp-preview/mockups/orden-mockups.html`)

## Problem

`generateOrdenPDF` shows a fraction of what the system knows about a service
order (full inventory: engram `stapp/orden-pdf-estudio`). Missing on paper:
work breakdown (parts + labor), final total and payment state, warranty,
diagnosis, real state timeline, human order code, attribution (who received /
technician / who delivered), branch identity, client tax identity, custom
per-device fields. The public tracking page already shows more than the PDF.

## Design (per approved mockups)

One visual system, two moments:

### Sheet "RECEPCIÓN" (printed at intake) — with cut line
- **Client part** (top ~2/3): logo + org/branch header, big `#numero` +
  `codigo_orden`, state timeline with only completed states dated, cliente
  (with DNI/CUIT + razón social when empresa), equipo (+ custom `metadata`
  fields), falla declarada, accesorios + fotos-count line, money band
  (presupuesto / seña + método / saldo estimado), fecha prometida line, QR
  seguimiento, firma cliente + "Recibió {nombre}", terms (org-configurable).
- **✂ cut line** with "Parte superior · Cliente / Talón inferior · Negocio".
- **Business stub** (bottom ~1/3, dense grid): cliente + tel, equipo + IMEI,
  **access code (PIN/pattern) ONLY here — removed from the client part**
  (security improvement over today), compact checklist with damage notes,
  counter notes + assigned technician, presupuesto/seña, fecha prometida.

### Sheet "ENTREGA" (printed at/after delivery) — full expediente
Everything above plus: diagnóstico técnico beside the falla, **trabajo
realizado table** (repuestos_orden: name/qty/precio_venta + labor) with
subtotal/descuento/**TOTAL FINAL** (`costo_final`)/SALDO (from
`total_cobrado`), pagos registrados table (cobros_orden with method +
reference), checklist grouped by categoria, **garantía box** (días,
vencimiento, condiciones, código for claims), full timeline dated
(orden_tiempos_estado), attribution row (Recibió / Técnico / Entregó +
ingreso/completado/entrega datetimes), three signatures (recepción on file,
cliente entrega, negocio).

State-aware: one layout that fills in as the order progresses; the sheet
printed depends on estado (terminal ENTREGADO* states → entrega sheet).

### Visual language
- Type: **Archivo** (static TTFs embedded, several weights incl. condensed
  for big numbers) + **IBM Plex Mono** for IMEI/codes. Replaces Inter for
  this document only (Inter stays for other docs until they migrate).
- Monochrome stays (MONO palette; black panels for money/estado allowed as
  in mockups — solid `MONO.ink` fills with white text are permitted here,
  superseding the "totalBg-only fill" rule FOR THIS DOCUMENT).
- Grid cells with hairline borders; timeline strip; logo slot top-left
  (existing `logo_url`, fallback = no box).

## Data layer additions (route `app/api/ordenes/[id]/pdf/route.ts` + `OrdenPDFData`)

Zero-cost (already fetched, map only): `codigo_orden`, `diagnostico`,
`costo_final`, `total_cobrado`, `estado_cobro`, `descuento_cobro`,
`motivo_sin_cobro`, `telefono_contacto`, `metadata`, `es_reingreso`,
`orden_origen_id`, `fecha_completado`, `cliente.{dni,cuit,razon_social,tipo_cliente}`,
`org.email`.

New joins: `sucursales` (name/address/phone), `users` names for `tecnico_id`
+ `recibido_por`, `repuestos_orden` (nombre, cantidad, precio_venta_unitario),
`garantias` (dias_validez, fecha_vencimiento, estado, notas), `cobros_orden`
(non-anulado: monto, metodo_pago, numero_referencia, fecha),
`orden_tiempos_estado` (estado, inicio) for the timeline, checklist select
gains `categoria`.

Never on the document: `notas_internas` (explicitly forbidden), costs
(precio_unitario cost, horas/costo_hora), commissions.

## Out of scope

- Other generators, thermal print, public portal.
- Library migration — pdf-lib renders all of this (fonts embeddable, rects,
  SVG-path pattern lock already drawn today).
- Photo thumbnails inline (photo PAGE stays as today, appended; the sheet
  shows counts).

## Sequencing

Executes AFTER the remito slice-1 PR lands (both touch lib/pdf.ts). Branch
chains on `feat/remito-contable`. Suggested slices: D1 fonts/logo/shared
scaffolding + recepción sheet (client + stub + cut line), D2 entrega sheet +
data joins, D3 route/state wiring + samples + visual gate.
