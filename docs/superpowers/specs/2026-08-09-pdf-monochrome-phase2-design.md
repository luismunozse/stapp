# PDF Monochrome Phase 2 — Design

Date: 2026-08-09
Status: Approved by user (scope: all three items; section name: "Comprobantes")

## Problem

Phase 1 (PR #281) restyled `generateOrdenPDF` and `generateFacturaPDF` to the
monochrome typographic system and renamed the drawn document FACTURA → REMITO.
Remaining debt: (A) the other six generators in `lib/pdf.ts` still use the old
indigo theme with per-function color constants; (B) the UI section is still
called "Facturación" and labels still say "Factura"; (C) the remito silently
truncates long item/payment lists on overflow.

## Scope — three chained PRs based on `feat/rediseno-comprobantes-a4`

Chain strategy: each PR bases on the previous one's branch. Do NOT delete a
base branch after merging until its child PR is retargeted (known gotcha:
deleting the base closes the child PR).

### PR A — migrate the six remaining generators (visual only)

Restyle to the established house style (reference implementations:
`generateOrdenPDF` and `generateFacturaPDF` in the same file; shared module
`lib/pdf-style.ts`):
- `generateCotizacionPDF` (largest; ORDEN | PRESUPUESTO variants, checklist,
  condiciones, approval signature)
- `generateVentaPDF`
- `generateDevolucionPDF`
- `generateGarantiaVentaPDF`
- `generateComprobanteEntregaPDF`
- `generateVentaTicketPDF` (58/80mm thermal ticket — MINIMAL change: colors to
  MONO only, no layout/spacing changes; a pending thermal-calibration branch
  may touch this function and thermal printers print black regardless; the
  digital-share path via pos-ticket-share is why it migrates at all)

House style rules (identical to phase 1):
- Palette: `MONO` only; the sole allowed area fill is `MONO.totalBg` on
  TOTAL/money-highlight bars. No non-MONO `rgb()` calls AND no non-MONO hex
  color strings (lesson learned: QRCode.toDataURL hex escaped the rgb sweep).
- Section headings via `drawSectionLabel`; fine-print sections use `MONO.faint`
  directly. Doc titles `TYPE.docTitle` bold ink; big numbers `TYPE.docNumber`.
- Solid `drawRule` for major breaks, dotted for internal; tables get bold
  uppercase `MONO.label` headers, no fills, hairline row rules.
- Status/type badges via `drawOutlinedBadge` (wording preserved).
- Every string drawn as a single `drawText` call.
- Behavior preserved exactly: signatures, QRs, variants, overflow guards,
  page setup, dynamic crops. Delete each function's dead color constants.

Tests: each generator gets (or keeps) an `extractPdfText` smoke test; the
env-gated sample generator gains one sample per document for the visual gate.

### PR B — UI rename "Facturación" → "Comprobantes"

- Section/menu/nav entry, page titles, breadcrumbs: "Facturación" → "Comprobantes".
- Document labels in that section's UI: "Factura Nº/Factura" → "Remito Nº/Remito"
  (matching the drawn REMITO title from phase 1).
- Routes, file names, function names, DB tables unchanged (`/facturacion` URL
  stays — renaming routes breaks bookmarks/deep-links for zero gain).
- Toasts/dialogs/empty states inside the section follow the same wording.

### PR C — remito pagination

- When items + payment history do not fit one A4 page, continue on a
  continuation page headed `REMITO {numero} — continuación` (minimal header:
  doc title + number + page context, no full company header) instead of
  silently truncating via the current `break` guards.
- Single-page output stays byte-identical in layout when content fits.
- TDD: fixture with enough items + pagos to overflow; assert continuation
  content appears (last item and last payment present in extracted text) and
  short fixtures still produce one page.

## Out of scope

- Route/function/table renames; terminología engine changes.
- Pagination for any document other than the remito.
- Thermal ticket layout/calibration changes beyond color.
