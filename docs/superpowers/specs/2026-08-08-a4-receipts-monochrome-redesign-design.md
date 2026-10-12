# A4 Receipts Monochrome Redesign — Design

Date: 2026-08-08
Status: Approved by user (style direction: minimal typographic, pure grayscale)

## Problem

The A4 service-order receipt (`generateOrdenPDF`) and the internal billing document
(`generateFacturaPDF`) in `lib/pdf.ts` look dated and have weak reading hierarchy.
Every generator redeclares its own indigo `rgb(...)` constants (`#6366f1` theme),
and the values drift between functions. Additionally, `generateFacturaPDF` titles
the document "FACTURA" even though it is a non-fiscal internal receipt (no
AFIP/ARCA/CUIT/CAE fields exist) — the correct name for this document is "REMITO".

## Scope

1. **`generateOrdenPDF`** (lib/pdf.ts:830–1911) — full monochrome restyle of all
   sub-pages: client copy, "copia local" compact page, intake-photos page, and
   delivery (entrega) page. Structure and flow are preserved exactly: cut-line
   assembly into one sheet, dynamic height crop, QR code, signatures, pattern-lock
   grid, `soloCliente` variant.
2. **`generateFacturaPDF`** (lib/pdf.ts:3237–3616) — monochrome restyle, and the
   document title changes from "FACTURA {numero}" to "REMITO {numero}". API routes,
   file names, and function names do NOT change.
3. **Shared style constants** — extract a single monochrome palette + type scale
   block consumed by both redesigned functions, eliminating per-function constant
   drift and leaving a migration path for the remaining generators.

## Visual system (pure grayscale)

- **Ink**: body text `#111`; section labels `#555`; fine print `#999`; hairline
  rules `#ccc` at 0.5pt. No color fills anywhere. The only allowed fill is
  `#f2f2f2` behind the TOTAL bar.
- **Typography**: existing embedded Inter Regular/Bold. Hierarchy:
  - Order/remito number: 18pt bold
  - Document title: 10pt bold, letterspaced
  - Section labels: 6.5pt UPPERCASE, letterspaced, `#555`
  - Body: 9pt; legal/fine print: 6.5pt
  - Courier remains for IMEI / access codes.
- **Separators**: thin solid rule for major breaks (header, footer, totals);
  dotted rule between internal sections. No boxes except tables.
- **Tables** (items, checklist, payment history): horizontal hairline rules only,
  bold header row with no background fill.
- **Status badges** (RECEPCIÓN, PAGADO, PENDIENTE, etc.): bold uppercase text
  inside a thin black outlined pill, no fill.
- **Money**: amounts right-aligned; TOTAL at 12pt bold over the `#f2f2f2` bar.
- Pattern-lock grid, QR, and signature blocks keep their behavior, redrawn in black.

## Testing (Strict TDD active)

- Smoke tests using the existing `__tests__/lib/pdf-text-helper.ts`
  (`extractPdfText`):
  - `generateFacturaPDF`: output contains "REMITO", does not contain "FACTURA".
  - `generateOrdenPDF`: key sections present (currently has zero direct tests).
- Before modifying `lib/pdf.ts`, generate sample PDFs from fixture data so the
  user can open and approve the real look.

## Out of scope (recorded debt)

- `generateVentaPDF`, cotización, garantía, devolución generators keep the indigo
  theme for now; they migrate later onto the shared constants.
- Renaming "Facturación" in the UI/menus — separate PR if desired.
- Pagination for the remito when payment history overflows — current truncation
  behavior is preserved.
