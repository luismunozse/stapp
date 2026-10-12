# Comprobantes — Unifying the document shell — Design

Date: 2026-08-23
Status: Approved by user (2026-08-23 conversation: chose "shared shell + document-by-document migration" over a big-bang rewrite and over consolidating on pdf-lib; approved making the CI render check slice 0 rather than a manual post-deploy step)

## Problem

The app renders eleven PDF documents across two engines. The visual language is
already unified — `lib/pdf.ts` uses the monochrome tokens from `lib/pdf-style.ts`
in 534 places, inherited from the A4 redesign (#281-#286). What is NOT unified is
the document *structure*: `nombreEmpresa` appears in 15 separate places in
`lib/pdf.ts` because every generator redraws its own emisor header, cliente band
and footer. Adding a document means reimplementing the frame to change only the
middle.

The duplication is visible in the section-label vocabulary. Across the nine
pdf-lib generators:

| Repeated structure | Occurrences |
|---|---|
| `CLIENTE` / `DATOS DEL CLIENTE` | 6 |
| `DETALLE DE ITEMS` / `DE PRODUCTOS` / `DETALLE` | 5 |
| signature blocks (six different wordings) | 6 |
| `HISTORIAL DE PAGOS` / `Pagos registrados` | 2 |
| `OBSERVACIONES` / `NOTAS DE ENTREGA` | 2 |

The non-fiscal legend is written three different ways across the three engine
files.

Current inventory:

| Generator | Lines | Engine | Notes |
|---|---|---|---|
| `generateOrdenPDF` | 1447 | pdf-lib | only user of the Archivo font (`embedExpedienteFonts`) |
| `generateFacturaPDFLegacy` | 820 | pdf-lib | superseded by the react-pdf remito |
| `generateCotizacionPDF` | 697 | pdf-lib | has a public route |
| `generateComprobanteEntregaPDF` | 377 | pdf-lib | |
| `generateGarantiaVentaPDF` | 305 | pdf-lib | |
| `generateVentaTicketPDF` | 227 | pdf-lib | thermal 58/80 — out of scope |
| `generateVentaPDF` | 220 | pdf-lib | |
| `generateDevolucionPDF` | 152 | pdf-lib | |
| `generateFacturaPDF` | 8 | dispatcher | |
| `generateFacturaPDFReact` (remito) | — | react-pdf | `lib/remito-react-pdf.tsx` |
| `generateReciboCCPDF`, `generateResumenCCPDF` | — | react-pdf | `lib/cuenta-corriente-react-pdf.tsx` |

## Decisions (locked)

1. **One engine going forward: react-pdf.** Documents migrate one per PR, not in
   a single rewrite. Coexistence with pdf-lib is explicit and bounded to the
   duration of the migration.
2. **The shell is a set of pieces, not one monolithic component.** A document
   composes `<Cabecera>`, `<BandaCliente>`, `<Seccion>`, `<Tabla>` etc. rather
   than passing twenty props to a `<Documento>`.
3. **Only structure moves to the shell.** Document-specific sections (equipo,
   garantía terms, checklist de recepción, código de acceso, vendedor) stay in
   their document.
4. **The CI render check comes first**, before any document migrates. See
   "Slice 0" — it is the harness that makes the other slices safe.
5. **`generateFacturaPDFLegacy` and `REMITO_PDF_ENGINE` are removed last**, not
   first, even though they are the single largest dead-code win (820 lines).
   Removing the escape hatch from the old engine while migrating nine documents
   *onto* the new one is backwards.

## Non-goals

- **The thermal ticket and ESC/POS.** `generateVentaTicketPDF` (58/80mm) and
  `lib/escpos.ts` are a different medium — 32 characters wide, no fonts, no
  layout. Forcing them into an A4 shell would be an abstraction that fits
  neither.
- **The document catalogue.** Factura, remito and comprobante de entrega remain
  three distinct documents even where they look alike. This design unifies how
  they are built and how they present, not which ones exist.
- **A production smoke test with credentials.** Considered and rejected: it needs
  production credentials in CI (a permanent security cost), depends on real
  document IDs that can be deleted, and detects after production is already
  broken. Slice 0 catches the same failure class before merge instead.

## The shell — `lib/pdf-react-shell.tsx`

`DocumentoBase` — the data interface every document's type extends: emisor
(nombre, teléfono, dirección, CUIT, condición IVA, domicilio fiscal, ingresos
brutos, inicio de actividades, logo), cliente, moneda, zona horaria, sucursal,
atendido por. Today each generator redeclares these.

| Piece | Responsibility |
|---|---|
| `<Cabecera>` | logo + emisor left, título + número + fechas + fiscal data right, with the truncation clamp. Letter box and centered legend are **optional** — the remito has them, the recibo does not. `zonaDerecha` (`"fija"` \| `"auto"`) is required, no default: it decides whether the right zone is pinned to a fixed width (starving the left zone/logo box if the content doesn't fit) or sized to its own content — a document must state which it needs. |
| `<BandaCliente>` | cliente left; free slot on the right for the document's own reference (`VENTA: V0020`, `ORDEN #0042`). |
| `<Seccion titulo>` | label only, no rule — each document still draws its own rule beneath it, because the three in this branch use slightly different ones. Wraps everything, including sections that are not shared. |
| `<Tabla>` | declared columns, header repeated across page breaks. |
| `<FilaDetalle>`, `<BarraTotal>` | subtotal / total / saldo, with the grey bar. There is no shared *emphasised* total row yet — see the note below. |
| `<Badge>`, `<Firmas>` | estado; conformity block parameterised instead of six copies. |
| `<Pie>`, `LEYENDA_NO_FISCAL` | footer and a single wording of the fiscal legend. |

`CabeceraCC` and `PieCC` in `lib/cuenta-corriente-react-pdf.tsx` are the seed —
they already do this for two documents. Slice 1 generalises them.

**Missing piece: an emphasised total row.** `FilaDetalle` hardcodes its own
typography, so it cannot serve as an emphasised row, and both documents that
needed one in slice 1 hand-rolled a different version: the remito reaches past
the shell into its own `estilosShell.filaDetalle` / `barraLabel` / `barraValor`
styles for its TOTAL row, and cuenta corriente hand-rolls `styles.totalRow` /
`totalLabel` / `totalValue` for IMPORTE RECIBIDO, with its own
`paddingVertical`/`marginTop`. It was **not** built as a shell piece in slice 1
— two hand-rolled instances are not enough to validate the cut, and a
premature `FilaTotal` risks guessing the wrong shape. When devolución or venta
needs the same conceptual row (slice 2/3), that is the third instance: treat
it as the trigger to extract `FilaTotal` rather than hand-rolling a fourth or
fifth copy.

## Migration recipe (per document)

1. **Characterization test first.** Written against the *current* pdf-lib
   generator and green on the old engine before anything changes. Asserts the
   facts the document must contain: número, cliente, ítems, totales, sections,
   legend. This test *is* the contract — today it exists only inside the PDF.
2. **Visual baseline.** `PDF_SAMPLES=1 PDF_SAMPLES_TAG=before npx vitest run
   __tests__/pdf-samples.test.ts`, using the existing harness and fixtures.
3. **Migrate** the document onto the shell.
4. **Same test, new engine, unedited.** This works because pdfjs
   (`__tests__/lib/pdf-text-helper-react.ts`) reads pdf-lib output too —
   verified against `generateVentaPDF`, including its subsetted Type0/Identity-H
   fonts. Use the pdfjs extractor for characterization tests, never the
   pdf-lib-specific one, so the engine swap is invisible to the test body.
5. **`TAG=after` and compare the two PDFs by eye, plus the golden harness.**
   Layout *will* change — that is the goal — but every difference must be one
   we chose. Deliberate ones get listed in the PR; the rest are bugs. Eyeballing
   the rendered PDF is necessary but not sufficient: `__tests__/pdf-golden.test.ts`
   (`PDF_GOLDEN=1`, see `__tests__/lib/pdf-golden-helper.ts`) compares every text
   item's page/x/y and the page content streams' graphics operators against a
   baseline dump, and it is what caught the invisible regressions slice 1's own
   eyeballing missed (a starved logo box, a re-wrapped dirección, and an 8-14pt
   signature-block shift). Run it before and after the migration and treat any
   diff the same as a failed characterization test.
6. **Open the document in production after merge.** Slice 0 covers bundle-level
   failures; this covers environment-specific ones (a missing env var, an
   unapplied migration, a logo URL that 404s).

Watch for date-only values in step 4: a fixture built with `new Date("2026-01-15")`
renders as `14/01/2026` in a UTC-3 timezone. Not a production bug — real dates
come from `timestamptz` with a time component — but before and after must treat
them identically or the test flags a difference the engine did not cause.

## Slices

Each slice is one PR and leaves the system healthy. The work can stop at any
slice.

| Slice | Content | Why here |
|---|---|---|
| **0** | CI render check against a production build | The safety net, before anything moves |
| **1** | Extract the shell; remito + recibo CC + resumen CC adopt it | All three are already react-pdf — proves the shell against three real documents without touching pdf-lib |
| **2** | devolución (152) | Smallest — shakes down the six-step recipe where mistakes are cheap |
| **3** | venta (220) | |
| **4** | garantía (305) | |
| **5** | comprobante de entrega (377) | |
| **6** | cotización (697) | Public route — more surface, so later |
| **7** | orden / expediente (1447) | A third of the file alone, and the only document needing the Archivo font registered in react-pdf |
| **8** | delete `generateFacturaPDFLegacy` + `REMITO_PDF_ENGINE` | Only once nothing needs rescuing |

End state: `lib/pdf.ts` goes from 4450 lines to roughly 230 — the thermal ticket,
which stays because it is a different medium.

## Slice 0 in detail — the CI render check

**Why it is not optional.** The app has two test layers and neither can see a
bundle-level failure. Vitest never compiles with Next. Playwright compiles with
Next but `playwright.config.ts` sets `webServer.command = "npm run dev"`, and
there is no PDF spec at all. React error #31 (fixed in #323) went between the
two: 2605 unit tests green, E2E green, and every PDF route broken in production
for weeks. The manual "test it in production" step is not a control — the repo's
own notes record "falta prueba física" unresolved on the remito, the thermal
comprobante, the código-de-acceso modal and the facturas-desde-ventas work.

**Shape.** After `next build`, start the server and render every react-pdf
document from fixtures, asserting a parseable PDF of non-trivial size. No
database, no auth, no tenant, no production credentials — the #31 reproduction
needed none of those. It runs pre-merge and blocks the PR.

**Two implementation traps**, both hit while reproducing #31:

- Next ignores directories whose name starts with an underscore, so a route at
  `app/api/public/__smoke/` is never routed. Use a name without one.
- Everything outside `/api/public` is redirected to `/login` by the middleware,
  and the rate limiter will reject a tight retry loop.

Any route added for this must be inert outside CI — gated on an env var that
production never sets, or kept out of the production build entirely.

## Risks

**The shell's cut is wrong.** Mitigated by slice 1: three real documents adopt it
before any pdf-lib document is touched. A bad cut surfaces there, cheaply.

**A migrated document silently loses content.** This is what the characterization
tests exist for, and why they must be green on the old engine first — a test
written after the migration only proves the new document is self-consistent.

**react-pdf breaks again the way #31 did.** Two guards now exist:
`__tests__/lib/react-pdf-reconciler-match.test.ts` fails in CI if the resolved
React drops below 19.2, and slice 0 catches bundle-level breakage generally.

**The Archivo font.** Only `generateOrdenPDF` uses it. react-pdf registers custom
fonts, but font loading is exactly the kind of thing that works locally and fails
in a bundle. Slice 7 is last for this reason, and slice 0 must cover it.
