# Remito — Migration to @react-pdf/renderer — Design

Date: 2026-08-19
Status: Approved by user (2026-08-19 conversation: saw spike output side by side, chose "Migrar el remito a react-pdf" over porting the look to pdf-lib, with tradeoffs presented explicitly)

## Problem

The user prefers the visual result of the react-pdf spike clone (branch
`spike/react-pdf-remito`, commit 43f1bc6a: `scripts/spike-react-pdf/remito.tsx`)
over the shipped pdf-lib remito, and decided to replace the remito's rendering
engine. Only the remito migrates; the other ~9 generators in `lib/pdf.ts`
(orden, venta, recepción, devolución, cotización, garantía, entrega, ticket
térmico, etiquetas) stay on pdf-lib.

## Decisions (locked)

1. **Interface unchanged.** `generateFacturaPDF(data: FacturaPDFData): Promise<Buffer>`
   keeps its name, signature, and the `FacturaPDFData` type verbatim.
   `app/api/facturacion/[id]/pdf/route.ts` is NOT touched.
2. **Engine fallback for one release.** The current pdf-lib implementation is
   renamed `generateFacturaPDFLegacy` (same file, unexported or exported for
   tests). `generateFacturaPDF` becomes a thin dispatcher: if
   `process.env.REMITO_PDF_ENGINE === "pdflib"` → legacy; otherwise → the new
   react-pdf implementation. This is the escape hatch on a business-critical
   collections document; removal is a later cleanup.
3. **Font: base-14 Helvetica** (`Helvetica` / `Helvetica-Bold`), no custom font
   embedding. This IS the look the user approved. Consequences accepted:
   smaller files, faster renders, WinAnsi glyph set (ASCII + Latin-1 covers
   Spanish).
4. **Table frames on page breaks: CSS-fragmentation behavior accepted.** When
   a framed table splits across pages, react-pdf keeps left/right borders
   running without a bottom-close/top-close at the cut. The user saw this in
   `react-remito-largo.pdf` and approved the overall result. No workaround is
   built.
5. **New module**: `lib/remito-react-pdf.tsx` exporting
   `generateFacturaPDFReact(data: FacturaPDFData): Promise<Buffer>`, built
   from the spike component (start by copying
   `git show spike/react-pdf-remito:scripts/spike-react-pdf/remito.tsx`).
   `lib/pdf.ts` imports it for the dispatcher. React component + StyleSheet
   live in the new file; `lib/pdf.ts` gains no JSX.
6. **Dependencies**: `@react-pdf/renderer` (^4.6.1) as a production
   dependency (~10.4 MB node_modules; plain-Node `renderToBuffer`, no
   browser — Vercel-safe; react 18.3.1 already present). `pdfjs-dist` as a
   devDependency for test text extraction.
7. **Truncation clamp** (company name / left-zone lines vs the centered letter
   box): react-pdf has no ellipsis primitive and no public text-measurement
   API. Measure with pdf-lib's `StandardFonts.Helvetica` metrics
   (`font.widthOfTextAtSize`) — pdf-lib remains a dependency anyway — in a
   small helper (`measureHelvetica(text, size)`), and truncate with `…` before
   passing strings to the component. Same behavior contract as the legacy
   `clampLeftZoneText`.

## Functional contract (what the react-pdf remito must render)

Everything the shipped classic remito renders, same content rules:

- Letter box **X** straddling the outer frame's top edge + legend
  `Documento no válido como comprobante fiscal`; strings `R` (as document
  letter) / `Cód. 91` never rendered.
- Header zones — left: logo (from `logoUrl`, when present), company name
  bold, tel, dirección (deduped against domicilio fiscal when identical
  post-trim), every line clamped against the letter box; right: `REMITO`,
  `Nº {numeroFactura}`, `Emisión`, `Operación` (conditional), `CUIT`,
  `Ingresos brutos`, `Inicio actividades` (each conditional), condición IVA
  uppercased.
- CLIENTE band (name bold; conditional domicilio/tel/email; right half
  `CUIT/DNI` + uppercased `VENTA: V0000` / `ORDEN: {código} — {dispositivo}`
  with the existing number padding and conditional em-dash) and CONDICIONES
  band (conditional on any of vencimiento/medios/CBU), inside an outer frame.
- Framed ruled items table CANT | DESCRIPCIÓN | PRECIO | SUBTOTAL (right
  aligns for money columns; header repeats on continuation pages via scoped
  `fixed`).
- Money block: Subtotal / IVA / Descuento / Redondeo (each conditional) /
  TOTAL / Pagado a cuenta / SALDO(-PENDIENTE) highlight bar, kept together
  (`wrap={false}`).
- ESTADO DE PAGO outlined badge + Abonado/Pendiente amounts.
- Framed HISTORIAL DE PAGOS with running saldo column and the
  cuotas/recargo note line under qualifying rows.
- RECIBÍ CONFORME signature block (orden-sourced only, kept together).
- Footer on every page (disclaimer `Remito interno — no válido como
  comprobante fiscal.`, `Impreso:` timestamp, `Página N de M` when >1) via
  `fixed` + `render`; `— continuación` title on pages >1.
- Degradation guarantee: every optional field renders only when present; an
  org with no fiscal data renders the same info inside the frame.
- **One-page acceptance**: the typical remito (3 items + 3 pagos, first with
  cuotas/recargo note + CONDICIONES 3 lines + full fiscal header) fits on
  exactly 1 A4 page. Large remitos paginate with repeating table headers.

## Test strategy

- **New extraction helper** `__tests__/lib/pdf-text-helper-react.ts` built on
  `pdfjs-dist` (`getDocument` → `page.getTextContent()`): exports
  `extractReactPdfText(buffer): Promise<string>` and
  `extractReactPdfTextPositions(buffer): Promise<Array<{text, x, y, page}>>`
  (pdfjs `transform[4]`/`[5]` → x/y, per page). The legacy helper stays for
  pdf-lib documents.
- **New suite** `__tests__/lib/remito-react-pdf.test.ts` porting the remito
  assertions from `factura-pdf-venta.test.ts` against the new engine:
  content assertions (letter-box legend, negative R/Cód. 91, conditional
  fiscal lines, band content, origin references, money content, cuotas
  notes, dedupe, clamp/truncation), structural assertions (page counts,
  one-page acceptance, A4 mediaBox invariant, note-count under pagination,
  repeated table header text on continuation pages). Exact-coordinate pins
  from the legacy suite (letter-box x/y band, 23pt gap, 28pt spacing) are
  legacy-specific: replace with relative/structural equivalents (e.g. X
  glyph present on page 1 upper band; note line lies between its row and the
  next row's y).
- **Legacy suite keeps passing** against `generateFacturaPDFLegacy` (the
  dispatcher test sets `REMITO_PDF_ENGINE=pdflib` or the suite imports the
  legacy function directly) — it is the fallback's regression net.
- **Dispatcher test**: env unset → react output (pdfjs extractor reads it);
  env `pdflib` → legacy output (legacy extractor reads it).
- `__tests__/pdf-samples.test.ts`: remito fixtures render through the NEW
  engine (samples are the visual QA artifact); other documents unchanged.

## Out of scope

- Migrating any other generator; changing `FacturaPDFData`; the PDF route;
  custom font embedding; closed per-page table frames; removing the legacy
  path (later cleanup once the new engine survives real use).

## Risks

- pdfjs-dist in vitest node env needs the legacy build import path
  (`pdfjs-dist/legacy/build/pdf.mjs`) to avoid worker/DOM requirements —
  handle inside the helper.
- react-pdf renders in vitest's node environment fine (proven by the spike
  via tsx), but the suite file must run with `// @vitest-environment node`.
- JSX in `lib/`: Next.js compiles `.tsx` under `lib/` out of the box; vitest
  uses esbuild — no config change expected, verify early (Task 1).
