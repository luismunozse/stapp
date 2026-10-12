# PDF Monochrome Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the six remaining PDF generators to the monochrome house style, rename the "Facturación" UI section to "Comprobantes", and add remito pagination — as three chained PRs.

**Architecture:** Same imperative pdf-lib code in `lib/pdf.ts`; the house style and its shared module `lib/pdf-style.ts` already exist (phase 1, PR #281). Reference implementations for every transformation decision: the restyled `generateOrdenPDF` and `generateFacturaPDF` in the same file. PR chain: A (`feat/pdf-monocromo-resto`, base `feat/rediseno-comprobantes-a4`) → B (`feat/ui-comprobantes`, base A) → C (`feat/remito-paginacion`, base B).

**Tech Stack:** pdf-lib, `lib/pdf-style.ts` (`MONO`, `TYPE`, `RULE_WIDTH`, `drawRule` with `{dotted?, color?, thickness?}`, `drawSectionLabel` → returns width, `drawOutlinedBadge`, `measureBadgeWidth`), vitest, `extractPdfText` (`__tests__/lib/pdf-text-helper.ts`), env-gated sample generator (`__tests__/pdf-samples.test.ts`).

**Spec:** `docs/superpowers/specs/2026-08-09-pdf-monochrome-phase2-design.md`

## Global Constraints

- House style per spec: `MONO` palette only; sole area fill `MONO.totalBg` on total/money bars; headings via `drawSectionLabel` (fine print `MONO.faint` direct); doc titles `TYPE.docTitle` bold ink; solid/dotted `drawRule`; badges `drawOutlinedBadge` (wording preserved); table headers bold uppercase `MONO.label`, no fills, hairline rules; single-`drawText` strings.
- Color sweep covers BOTH `rgb(` calls AND hex color strings (e.g. QRCode `dark:` options) — no non-MONO color in any migrated function.
- Preserve behavior exactly in every migrated generator: variants, signatures, QRs, overflow guards, page setup, dynamic crops, thermal widths. Delete dead per-function color constants after each migration.
- `generateVentaTicketPDF`: colors only — zero layout/spacing/width changes (pending thermal-calibration branch may touch it; thermal prints black anyway).
- Do not rename routes, files, exported functions, or DB entities anywhere in this phase.
- Run vitest one file at a time; NEVER concurrent vitest processes.
- Conventional commits; never add Co-Authored-By or AI attribution.
- Commands use bash syntax (env prefixes like `PDF_SAMPLES=1` run via Git Bash).
- Shared working tree: before each commit run `git log --oneline -3`; if an unrelated commit appears on top, STOP and report instead of committing.
- Chained-PR gotcha: never delete a merged base branch until the child PR is retargeted.

## File Structure

- Modify: `lib/pdf.ts` (six generator functions; Task bounds verified by the implementer at run time — line numbers drifted after phase 1).
- Modify: `__tests__/pdf-samples.test.ts` (one sample per newly migrated document, same `TAG` convention).
- Create: `__tests__/lib/venta-pdf.test.ts`, `__tests__/lib/cotizacion-pdf.test.ts`, `__tests__/lib/garantia-entrega-pdf.test.ts` (smoke tests; devolución joins venta's file).
- PR B: `components/facturacion/*`, nav/menu component(s), page metadata — discovered via grep protocol in Task 6.
- PR C: `lib/pdf.ts` (`generateFacturaPDF` pagination) + `__tests__/lib/factura-pdf-venta.test.ts` additions.

---

### Task 1: Migrate `generateVentaPDF` + `generateDevolucionPDF` (PR A)

**Files:**
- Modify: `lib/pdf.ts` (the two functions only)
- Create: `__tests__/lib/venta-pdf.test.ts`
- Modify: `__tests__/pdf-samples.test.ts`

**Interfaces:**
- Consumes: `@/lib/pdf-style` exports (already imported in lib/pdf.ts); house-style reference: restyled `generateOrdenPDF`/`generateFacturaPDF` in the same file.
- Produces: monochrome `generateVentaPDF`/`generateDevolucionPDF`, unchanged signatures; sample writes `{TAG}-venta.pdf`, `{TAG}-devolucion.pdf`.

- [ ] **Step 1: Smoke tests first (safety net — must PASS against current code; this task changes no text content).** New `__tests__/lib/venta-pdf.test.ts` with fully-typed fixtures (mirror the existing factura fixture discipline; omit `logoUrl`): one test per function asserting `extractPdfText` contains key strings the fixture guarantees (e.g. "COMPROBANTE DE VENTA", client name, an item description; devolución: its title + amounts) and `buffer.length > 1000`. Run: `npx vitest run __tests__/lib/venta-pdf.test.ts` → PASS. Commit `test(pdf): add smoke coverage for venta and devolucion PDFs`.
- [ ] **Step 2: Restyle both functions** applying the house style (headers: company name bold ink + contact `MONO.label`; the filled "VENTA #N" pill → right-aligned doc-title block like the remito; filled table headers → bold gray uppercase + hairline; totals bar `MONO.totalBg`; garantía color-coding → plain ink; delete dead constants). Behavior/branches/signatures untouched.
- [ ] **Step 3: Verify** `npx vitest run __tests__/lib/venta-pdf.test.ts` then `npx vitest run __tests__/lib/factura-pdf-venta.test.ts` → PASS. Color sweep of both function ranges (rgb + hex) → MONO only.
- [ ] **Step 4: Samples**: extend `__tests__/pdf-samples.test.ts` with venta + devolución writes; `PDF_SAMPLES=1 npx vitest run __tests__/pdf-samples.test.ts`; eyeball both PDFs.
- [ ] **Step 5: Commit** `feat(pdf): restyle venta and devolucion PDFs monochrome`.

---

### Task 2: Migrate `generateCotizacionPDF` (PR A)

**Files:**
- Modify: `lib/pdf.ts` (the function only)
- Create: `__tests__/lib/cotizacion-pdf.test.ts`
- Modify: `__tests__/pdf-samples.test.ts`

**Interfaces:** as Task 1. Produces samples `{TAG}-cotizacion-orden.pdf` and `{TAG}-cotizacion-presupuesto.pdf` (both `tipo` variants).

- [ ] **Step 1: Smoke tests first (PASS against current code)** — both `tipo: "ORDEN"` and `tipo: "PRESUPUESTO"` variants, checklist + condiciones + approval-signature content present. Commit `test(pdf): add smoke coverage for cotizacion PDF`.
- [ ] **Step 2: Restyle** per house style. Largest function (~700 lines): checklist and condiciones sections follow the orden comprobante's checklist/terms treatment; approval-signature block follows the entrega signature treatment (outlined boxes, ink underlines via `drawRule {color: MONO.ink}`).
- [ ] **Step 3: Verify** cotizacion tests + color sweep of the range.
- [ ] **Step 4: Samples** for both variants; eyeball.
- [ ] **Step 5: Commit** `feat(pdf): restyle cotizacion PDF monochrome`.

---

### Task 3: Migrate `generateGarantiaVentaPDF` + `generateComprobanteEntregaPDF` (PR A)

**Files:**
- Modify: `lib/pdf.ts` (the two functions only)
- Create: `__tests__/lib/garantia-entrega-pdf.test.ts`
- Modify: `__tests__/pdf-samples.test.ts`

**Interfaces:** as Task 1. Produces samples `{TAG}-garantia.pdf`, `{TAG}-entrega-standalone.pdf`.

- [ ] **Step 1: Smoke tests first (PASS against current code).** Signature fields via base64 1x1 PNG / data: URLs where the interfaces take them (established technique). Commit `test(pdf): add smoke coverage for garantia and entrega PDFs`.
- [ ] **Step 2: Restyle** both per house style; the standalone entrega mirrors the in-orden entrega page treatment from phase 1.
- [ ] **Step 3: Verify** tests + color sweep.
- [ ] **Step 4: Samples**; eyeball.
- [ ] **Step 5: Commit** `feat(pdf): restyle garantia and standalone entrega PDFs monochrome`.

---

### Task 4: Ticket térmico (colors only) + whole-file color sweep (PR A)

**Files:**
- Modify: `lib/pdf.ts` (`generateVentaTicketPDF` colors only)
- Modify: `__tests__/pdf-samples.test.ts`

- [ ] **Step 1: Color-only migration** of `generateVentaTicketPDF`: every color → nearest MONO equivalent; NO layout/spacing/font-size/width changes (diff must show only color-bearing lines changing).
- [ ] **Step 2: WHOLE-FILE sweep** — `rg -n "rgb\(|#[0-9a-fA-F]{6}" lib/pdf.ts`: every match must now be MONO-palette or inside `lib/pdf-style.ts` definitions. Zero non-MONO colors anywhere in lib/pdf.ts. Delete any now-dead constants.
- [ ] **Step 3: Sample** `{TAG}-ticket.pdf` (58mm variant); eyeball.
- [ ] **Step 4: Full suite** `npx vitest run` (single process) → green (known flake: exports-security 30s timeout under load; re-run isolated if it trips).
- [ ] **Step 5: Commit** `feat(pdf): migrate thermal ticket colors and complete monochrome sweep`.

---

### Task 5: Visual gate + PR A

- [ ] **Step 1: USER VISUAL GATE (blocking)** — present all new `after-*.pdf` paths (venta, devolución, cotización ×2, garantía, entrega standalone, ticket). Apply feedback before PR.
- [ ] **Step 2: Push + PR** targeting `feat/rediseno-comprobantes-a4`:
  title `feat(pdf): migrate remaining PDF generators to monochrome house style`; body summarizes scope + notes the thermal-calibration conflict risk kept minimal; test plan: suite green + visual gate.

---

### Task 6: UI rename "Facturación" → "Comprobantes" (PR B)

**Files:** discovered by grep protocol; branch `feat/ui-comprobantes` off `feat/pdf-monocromo-resto`.

- [ ] **Step 1: Inventory (grep protocol).** `rg -n -i "facturaci[oó]n|factura" components/facturacion app --glob '!**/api/**' -g '!*.test.*'` plus the nav/menu component and any page `metadata`/breadcrumb. Classify each hit: USER-VISIBLE STRING (rename) vs identifier/route/comment (keep). Produce the inventory in the report before editing.
- [ ] **Step 2: Rename user-visible strings**: section/menu/nav/titles/breadcrumbs → "Comprobantes"; document labels in that section → "Remito"/"Remito Nº" (toasts, dialogs, empty states, column headers included). Routes, identifiers, DB fields, API paths untouched. Terminología engine untouched.
- [ ] **Step 3: Tests.** Update any tests asserting old strings; add/extend a component test asserting the list page renders "Comprobantes" and "Remito" labels. Run the touched test files sequentially.
- [ ] **Step 4: Full suite** → green. Commit `feat(comprobantes): rename Facturacion section to Comprobantes with Remito labels`. Push + PR targeting `feat/pdf-monocromo-resto`.

---

### Task 7: Remito pagination (PR C)

**Files:** `lib/pdf.ts` (`generateFacturaPDF`), `__tests__/lib/factura-pdf-venta.test.ts`; branch `feat/remito-paginacion` off `feat/ui-comprobantes`.

- [ ] **Step 1: Failing tests FIRST (TDD — this IS a behavior change).** Fixture builder with N items + M pagos parameters. Tests: (a) 40 items + 15 pagos → extracted text contains the LAST item description and LAST payment reference (today's `break` guards drop them → RED); (b) contains "continuación"; (c) small fixture (3 items, 2 pagos) → single page (page count via pdf-lib `PDFDocument.load(buffer).getPageCount() === 1`) and text does NOT contain "continuación". Run → (a)/(b) FAIL, (c) PASS. Commit tests only after implementation (same commit) — do not commit red.
- [ ] **Step 2: Implement.** Replace both `break` overflow guards with page continuation: when `y` runs low inside items or pagos loops, `pdfDoc.addPage([595, 842])`, draw minimal continuation header (`REMITO {numero} — continuación` at `TYPE.docTitle` bold ink + solid rule), reset `y`, re-draw the table's column header row, continue the loop. Totals/estado/footer render after the last consumed row wherever the cursor is. Single-page layout byte-path unchanged when content fits.
- [ ] **Step 3: Verify** `npx vitest run __tests__/lib/factura-pdf-venta.test.ts` → all green (old + new).
- [ ] **Step 4: Sample** — add an overflow remito sample (`{TAG}-remito-largo.pdf`); eyeball page 2 header/columns.
- [ ] **Step 5: Full suite** → green. Commit `feat(pdf): paginate remito instead of truncating long item and payment lists`. Push + PR targeting `feat/ui-comprobantes`.
