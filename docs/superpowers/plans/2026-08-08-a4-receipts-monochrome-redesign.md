# A4 Receipts Monochrome Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle `generateOrdenPDF` and `generateFacturaPDF` to a minimal typographic, pure-grayscale design, and rename the internal invoice document from "FACTURA" to "REMITO".

**Architecture:** All PDF generation is imperative pdf-lib drawing inside `lib/pdf.ts` (3773 lines). A new `lib/pdf-style.ts` module centralizes the monochrome palette, type scale, and drawing helpers; the two redesigned generators consume it. Structure, data flow, page assembly (cut-line merge, dynamic crop, QR, signatures) are untouched — only visual styling and the document title change.

**Tech Stack:** pdf-lib, embedded Inter Regular/Bold + Courier, vitest, `__tests__/lib/pdf-text-helper.ts` (`extractPdfText`).

**Spec:** `docs/superpowers/specs/2026-08-08-a4-receipts-monochrome-redesign-design.md`

## Global Constraints

- Pure grayscale: no `rgb()` value outside the `MONO` palette may remain in the two redesigned functions. The ONLY area fill allowed is `MONO.totalBg` (#f2f2f2) behind total/presupuesto bars.
- Do NOT rename exported functions, API routes, or files. Only the drawn document title changes ("FACTURA {n}" → "REMITO {n}").
- Do NOT touch `generateVentaPDF`, `generateCotizacionPDF`, `generateGarantiaVentaPDF`, `generateComprobanteEntregaPDF`, `generateVentaTicketPDF`, `generateDevolucionPDF` (out of scope, stay indigo).
- Draw every text string as a single `drawText` call — NO per-character "letterspacing" loops. Per-char drawing breaks `extractPdfText`-based tests (chars extract with gaps). Hierarchy comes from size/weight/color only.
- Section labels: 6.5pt UPPERCASE bold, `MONO.label`. Body 9pt `MONO.ink`. Fine print 6.5pt `MONO.faint`. Hairlines 0.5pt `MONO.rule`. Courier stays for IMEI/PIN.
- Preserve existing behavior exactly: `soloCliente` variant, dynamic height crop (`setMediaBox/setCropBox/setTrimBox`), cut-line page merge, overflow guards (remito still truncates long payment history), pattern-lock grid geometry, QR, signature embedding.
- Run vitest one file at a time (`npx vitest run <file>`); NEVER launch concurrent vitest processes (they kill each other on this machine).
- Fixtures must set `logoUrl: undefined` (or omit) — a URL triggers a network fetch inside the generator.
- Conventional commits. Never add Co-Authored-By or AI attribution.
- Commands shown use bash syntax (`PDF_SAMPLES=1 npx ...`) — run them via Git Bash, not PowerShell.

## File Structure

- Create: `lib/pdf-style.ts` — monochrome palette, type scale, rule/badge helpers.
- Create: `__tests__/lib/pdf-style.test.ts` — unit tests for the module.
- Create: `__tests__/pdf-samples.test.ts` — env-gated manual sample generator (writes PDFs to `.tmp-preview/pdf-samples/`).
- Create: `__tests__/lib/orden-pdf.test.ts` — first-ever regression tests for `generateOrdenPDF`.
- Modify: `lib/pdf.ts` — `generateFacturaPDF` (3237–3616), `generateOrdenPDF` (830–1911) only.
- Modify: `__tests__/lib/factura-pdf-venta.test.ts` — update any "FACTURA" title assertions.

---

### Task 1: Shared monochrome style module

**Files:**
- Create: `lib/pdf-style.ts`
- Test: `__tests__/lib/pdf-style.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module; only `pdf-lib`).
- Produces (used by Tasks 3–5):
  - `MONO: { ink, label, faint, rule, totalBg, white }` — pdf-lib `RGB` values
  - `TYPE: { docNumber: 18, docTitle: 10, sectionLabel: 6.5, body: 9, small: 8, fine: 6.5, total: 12 }`
  - `RULE_WIDTH = 0.5`
  - `drawRule(page, x1, x2, y, opts?: { dotted?: boolean }): void`
  - `drawSectionLabel(page, fontBold, text, x, y): void`
  - `drawOutlinedBadge(page, fontBold, text, x, yTop, opts?: { size?: number }): { width: number; height: number }`
  - `measureBadgeWidth(fontBold, text, size?): number`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/pdf-style.test.ts
import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  MONO, TYPE, RULE_WIDTH,
  drawRule, drawSectionLabel, drawOutlinedBadge, measureBadgeWidth,
} from "@/lib/pdf-style";

describe("pdf-style", () => {
  it("exposes the monochrome palette from the spec", () => {
    expect(MONO.ink.red).toBeCloseTo(0.067, 3);
    expect(MONO.label.red).toBeCloseTo(0.333, 3);
    expect(MONO.faint.red).toBeCloseTo(0.6, 3);
    expect(MONO.rule.red).toBeCloseTo(0.8, 3);
    expect(MONO.totalBg.red).toBeCloseTo(0.949, 3);
    expect(TYPE.docNumber).toBe(18);
    expect(TYPE.sectionLabel).toBe(6.5);
    expect(RULE_WIDTH).toBe(0.5);
  });

  it("draws helpers without throwing and reports badge width", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    drawRule(page, 40, 555, 800);
    drawRule(page, 40, 555, 790, { dotted: true });
    drawSectionLabel(page, bold, "Cliente", 40, 780);
    const badge = drawOutlinedBadge(page, bold, "Recepción", 40, 770);
    expect(badge.width).toBeGreaterThan(20);
    expect(badge.height).toBeGreaterThan(10);
    expect(measureBadgeWidth(bold, "Recepción")).toBeCloseTo(badge.width, 5);
    const bytes = await doc.save();
    expect(bytes.length).toBeGreaterThan(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/pdf-style.test.ts`
Expected: FAIL — cannot resolve `@/lib/pdf-style`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/pdf-style.ts
import { rgb, type PDFPage, type PDFFont, type RGB } from "pdf-lib";

// Monochrome system for A4 receipt PDFs.
// Spec: docs/superpowers/specs/2026-08-08-a4-receipts-monochrome-redesign-design.md
export const MONO: Record<"ink" | "label" | "faint" | "rule" | "totalBg" | "white", RGB> = {
  ink: rgb(0.067, 0.067, 0.067), // #111 body text
  label: rgb(0.333, 0.333, 0.333), // #555 section labels
  faint: rgb(0.6, 0.6, 0.6), // #999 fine print
  rule: rgb(0.8, 0.8, 0.8), // #ccc hairlines
  totalBg: rgb(0.949, 0.949, 0.949), // #f2f2f2 — the ONLY allowed area fill
  white: rgb(1, 1, 1),
};

export const TYPE = {
  docNumber: 18,
  docTitle: 10,
  sectionLabel: 6.5,
  body: 9,
  small: 8,
  fine: 6.5,
  total: 12,
} as const;

export const RULE_WIDTH = 0.5;

const BADGE_SIZE = 7;
const BADGE_PAD_X = 5;
const BADGE_PAD_Y = 3.5;

export function drawRule(
  page: PDFPage,
  x1: number,
  x2: number,
  y: number,
  opts?: { dotted?: boolean }
): void {
  page.drawLine({
    start: { x: x1, y },
    end: { x: x2, y },
    thickness: RULE_WIDTH,
    color: MONO.rule,
    ...(opts?.dotted ? { dashArray: [1, 3] } : {}),
  });
}

export function drawSectionLabel(
  page: PDFPage,
  fontBold: PDFFont,
  text: string,
  x: number,
  y: number
): void {
  page.drawText(text.toUpperCase(), {
    x,
    y,
    size: TYPE.sectionLabel,
    font: fontBold,
    color: MONO.label,
  });
}

export function measureBadgeWidth(
  fontBold: PDFFont,
  text: string,
  size: number = BADGE_SIZE
): number {
  return fontBold.widthOfTextAtSize(text.toUpperCase(), size) + BADGE_PAD_X * 2;
}

export function drawOutlinedBadge(
  page: PDFPage,
  fontBold: PDFFont,
  text: string,
  x: number,
  yTop: number,
  opts?: { size?: number }
): { width: number; height: number } {
  const size = opts?.size ?? BADGE_SIZE;
  const label = text.toUpperCase();
  const width = measureBadgeWidth(fontBold, text, size);
  const height = size + BADGE_PAD_Y * 2;
  page.drawRectangle({
    x,
    y: yTop - height,
    width,
    height,
    borderColor: MONO.ink,
    borderWidth: 0.75,
  });
  page.drawText(label, {
    x: x + BADGE_PAD_X,
    y: yTop - height + BADGE_PAD_Y + 0.5,
    size,
    font: fontBold,
    color: MONO.ink,
  });
  return { width, height };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/pdf-style.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/pdf-style.ts __tests__/lib/pdf-style.test.ts
git commit -m "feat(pdf): add shared monochrome style module for A4 receipts"
```

---

### Task 2: Manual sample generator + BEFORE baselines

**Files:**
- Create: `__tests__/pdf-samples.test.ts`
- Read (for fixture shapes): `lib/pdf.ts` interfaces for `generateOrdenPDF` / `generateFacturaPDF` (near lines 830 / 3237), and existing fixtures in `__tests__/lib/factura-pdf-venta.test.ts`.

**Interfaces:**
- Consumes: `generateOrdenPDF`, `generateFacturaPDF` from `@/lib/pdf` (current signatures, unchanged).
- Produces: PDFs at `.tmp-preview/pdf-samples/{TAG}-orden.pdf` and `{TAG}-remito.pdf`, where `TAG` = `PDF_SAMPLES_TAG` env var (default `after`). Used by Task 6's visual gate.

- [ ] **Step 1: Write the env-gated generator test**

The fixture snippets below are representative; the generator interfaces in `lib/pdf.ts` are the source of truth — build the fixtures to satisfy those TypeScript types exactly (copy/adapt the factura fixture from `__tests__/lib/factura-pdf-venta.test.ts`, which already compiles). Populate EVERY optional visual feature so samples exercise the full layout: orden → accesorios, código de acceso (pattern), presupuesto + seña, observaciones, checklist (mixed SI/NO + free-text items), QR (`publicToken` + `baseUrl`), no logo; remito → items, descuento, redondeo, estado PAGADO_PARCIAL, 3-row payment history.

```ts
// __tests__/pdf-samples.test.ts
// Manual visual-sample generator. Skipped unless PDF_SAMPLES=1.
// Usage: PDF_SAMPLES=1 PDF_SAMPLES_TAG=before npx vitest run __tests__/pdf-samples.test.ts
import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { generateOrdenPDF, generateFacturaPDF } from "@/lib/pdf";

const OUT_DIR = ".tmp-preview/pdf-samples";
const TAG = process.env.PDF_SAMPLES_TAG ?? "after";

describe.runIf(process.env.PDF_SAMPLES === "1")("pdf visual samples", () => {
  it("writes orden and remito sample PDFs", async () => {
    mkdirSync(OUT_DIR, { recursive: true });

    const orden = await generateOrdenPDF({
      // Complete against the real interface — these are the intended contents:
      // empresa: "Servicio Técnico Demo", telefono/direccion set, logoUrl omitted,
      // numero 1042, fecha now, cliente Juan Pérez + tel/email/dirección,
      // equipo iPhone 13 / Negro / IMEI 358400123456789, tipo CELULAR,
      // problema: two full sentences so wrapping shows,
      // accesorios: "Cargador, funda, chip claro",
      // patrón de acceso: [0,1,2,5,8], presupuesto 45000, seña 10000,
      // observaciones: one sentence, checklist: 4 booleans mixed + 2 free items,
      // publicToken + baseUrl for the QR, moneda ARS, zonaHoraria America/Argentina/Buenos_Aires,
      // estado RECIBIDO (not ENTREGADO — entrega page reviewed separately in Task 5)
    } as Parameters<typeof generateOrdenPDF>[0]);
    writeFileSync(`${OUT_DIR}/${TAG}-orden.pdf`, orden);
    expect(orden.length).toBeGreaterThan(1000);

    const remito = await generateFacturaPDF({
      // Copy the venta-sourced fixture from __tests__/lib/factura-pdf-venta.test.ts
      // and extend: 3 items, descuento > 0, redondeo != 0,
      // estado PAGADO_PARCIAL, 3 payment-history rows, logoUrl omitted.
    } as Parameters<typeof generateFacturaPDF>[0]);
    writeFileSync(`${OUT_DIR}/${TAG}-remito.pdf`, remito);
    expect(remito.length).toBeGreaterThan(1000);
  }, 60_000);
});
```

Replace the two `as Parameters<...>` casts with real, fully-typed fixture objects — the cast must NOT survive this task; the compiler must check every field.

- [ ] **Step 2: Verify it is skipped by default**

Run: `npx vitest run __tests__/pdf-samples.test.ts`
Expected: suite reported as skipped, 0 failures.

- [ ] **Step 3: Generate BEFORE baselines (current indigo design)**

Run: `PDF_SAMPLES=1 PDF_SAMPLES_TAG=before npx vitest run __tests__/pdf-samples.test.ts`
Expected: PASS; `.tmp-preview/pdf-samples/before-orden.pdf` and `before-remito.pdf` exist. Open both to confirm they render (they show the CURRENT design — that is correct at this stage).

- [ ] **Step 4: Commit**

```bash
git add __tests__/pdf-samples.test.ts
git commit -m "test(pdf): add env-gated visual sample generator for A4 receipts"
```

---

### Task 3: Remito — rename + monochrome restyle of `generateFacturaPDF`

**Files:**
- Modify: `lib/pdf.ts:3237-3616` (`generateFacturaPDF` only)
- Modify: `__tests__/lib/factura-pdf-venta.test.ts` (title assertions, if any)
- Test: extend `__tests__/lib/factura-pdf-venta.test.ts`

**Interfaces:**
- Consumes: `MONO`, `TYPE`, `RULE_WIDTH`, `drawRule`, `drawSectionLabel`, `drawOutlinedBadge`, `measureBadgeWidth` from `@/lib/pdf-style` (Task 1).
- Produces: same `generateFacturaPDF` signature; drawn title becomes `REMITO {numero}`; footer line becomes `"Remito interno — no válido como comprobante fiscal."`.

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/lib/factura-pdf-venta.test.ts`, reusing its existing fixture builders and `extractPdfText`:

```ts
it("titles the document REMITO and drops the FACTURA name", async () => {
  const buffer = await generateFacturaPDF(/* existing venta-sourced fixture */);
  const text = await extractPdfText(buffer);
  expect(text).toContain("REMITO");
  expect(text).not.toContain("FACTURA"); // uppercase check: lowercase "facturación" elsewhere is fine
});

it("keeps key sections after the restyle", async () => {
  const buffer = await generateFacturaPDF(/* fixture with items + pagos + estado */);
  const text = await extractPdfText(buffer);
  expect(text).toContain("CLIENTE");
  expect(text).toContain("TOTAL");
  expect(text).toContain("ESTADO DE PAGO");
  expect(text).toContain("Remito interno — no válido como comprobante fiscal.");
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run __tests__/lib/factura-pdf-venta.test.ts`
Expected: the two new tests FAIL (document still says FACTURA); pre-existing tests PASS. If a pre-existing test asserts the "FACTURA" title, update it in this step to expect "REMITO" (it will fail until Step 3 — that is the TDD signal).

- [ ] **Step 3: Restyle the function**

Import the Task 1 module at the top of `lib/pdf.ts`:

```ts
import { MONO, TYPE, RULE_WIDTH, drawRule, drawSectionLabel, drawOutlinedBadge, measureBadgeWidth } from "@/lib/pdf-style";
```

Then apply this transformation contract to `generateFacturaPDF` (top-to-bottom; delete the function-local color constants when done — `primaryColor`, `primaryDark`, `grayColor`, `lightGray`, `bgGray`, `greenColor`, `redColor`, `orangeColor` must all be gone from this function):

| Current element (explore refs lib/pdf.ts:3237-3616) | New treatment |
|---|---|
| 10px indigo top accent bar | DELETE (no bar) |
| Empresa name 20pt bold indigo + tel/dirección 9pt gray | Name 16pt bold `MONO.ink`; contact lines 8pt `MONO.label` |
| Filled indigo "FACTURA {numero}" badge top-right | Right-aligned block: `REMITO` at `TYPE.docTitle` (10pt) bold `MONO.ink`; `{numero}` below at `TYPE.docNumber` (18pt) bold `MONO.ink`; `Fecha:` line 8pt `MONO.label` |
| 2pt indigo divider + centered "FACTURA" 14pt title | Single solid `drawRule` across content width (the header title block above replaces the centered title — do NOT draw "FACTURA" anywhere) |
| CLIENTE / VENTA / ORDEN DE SERVICIO bgGray boxes | No fills, no borders. `drawSectionLabel` heading + body 9pt `MONO.ink`, two columns as today; dotted `drawRule` below the pair |
| DETALLE DE ITEMS indigo-filled header row | Keep column layout; header row = 8pt bold UPPERCASE `MONO.label`, no fill; solid `drawRule` under header; row separators = existing thin lines but `MONO.rule` at `RULE_WIDTH` |
| Aggregate DETALLE table (Subtotal / IVA / Descuento red / Redondeo) | Right-aligned label:value rows, 9pt; labels `MONO.label`, values `MONO.ink` (Descuento shown as "-$X" in ink, no red); hairline above the block |
| bgGray TOTAL bar | KEEP the bar concept: `MONO.totalBg` filled rect, `TOTAL` + amount at `TYPE.total` (12pt) bold `MONO.ink`, amount right-aligned |
| ESTADO DE PAGO colored badge (green/red/orange) | `drawOutlinedBadge(page, fontBold, estadoLabel, ...)` — same wording (PAGADO / PENDIENTE / PAGADO PARCIAL / ANULADA), ink outline, no fill; "Abonado"/"Pendiente" amounts 9pt ink |
| HISTORIAL DE PAGOS indigo header table | Same treatment as items table (bold gray uppercase header, hairline rules); keep the existing overflow `break` guard untouched |
| Footer "Este documento es un comprobante interno de facturación." + second line | Replace both with one line: `Remito interno — no válido como comprobante fiscal.` at `TYPE.fine`, `MONO.faint`; keep `Impreso: {fecha}` line as-is but `MONO.faint` |
| 8px indigo bottom accent bar | DELETE; final solid `drawRule` above the footer text instead |

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/factura-pdf-venta.test.ts`
Expected: ALL tests PASS (new + pre-existing).

- [ ] **Step 5: Regenerate remito sample and eyeball it**

Run: `PDF_SAMPLES=1 npx vitest run __tests__/pdf-samples.test.ts`
Expected: PASS; open `.tmp-preview/pdf-samples/after-remito.pdf` — grayscale only, REMITO title, outlined estado badge, gray TOTAL bar. Compare against `before-remito.pdf`.

- [ ] **Step 6: Commit**

```bash
git add lib/pdf.ts __tests__/lib/factura-pdf-venta.test.ts
git commit -m "feat(pdf): rename factura to remito and restyle it monochrome"
```

---

### Task 4: Orden — regression tests + monochrome restyle of the client copy

**Files:**
- Create: `__tests__/lib/orden-pdf.test.ts`
- Modify: `lib/pdf.ts:830-1911` (`generateOrdenPDF` — client-copy page only in this task: constants block + sections 1–13 of the client page)

**Interfaces:**
- Consumes: same `@/lib/pdf-style` exports as Task 3.
- Produces: unchanged `generateOrdenPDF` signature and page-assembly behavior; Task 5 continues inside the same function (copia local / fotos / entrega blocks).

- [ ] **Step 1: Write regression tests (they must PASS before the restyle — safety net, not failing-first: this task changes no text content)**

```ts
// __tests__/lib/orden-pdf.test.ts
import { describe, it, expect } from "vitest";
import { generateOrdenPDF } from "@/lib/pdf";
import { extractPdfText } from "./pdf-text-helper";

// Reuse the exact fixture object from __tests__/pdf-samples.test.ts (extract it
// to a small shared helper `__tests__/lib/orden-fixture.ts` in this step so both
// files import one fixture builder).
import { buildOrdenFixture } from "./orden-fixture";

describe("generateOrdenPDF", () => {
  it("renders the comprobante with all key sections", async () => {
    const buffer = await generateOrdenPDF(buildOrdenFixture());
    const text = await extractPdfText(buffer);
    for (const section of [
      "COMPROBANTE DE RECEPCIÓN",
      "CLIENTE",
      "PROBLEMA REPORTADO",
      "ACCESORIOS",
      "Juan Pérez", // body content survives
    ]) {
      expect(text).toContain(section);
    }
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it("renders the soloCliente variant", async () => {
    const buffer = await generateOrdenPDF({ ...buildOrdenFixture(), soloCliente: true });
    const text = await extractPdfText(buffer);
    expect(text).toContain("COMPROBANTE DE RECEPCIÓN");
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
```

Adjust the asserted strings to whatever the fixture actually contains (e.g. the EQUIPO heading may be terminología-dependent — assert only on strings the fixture guarantees).

- [ ] **Step 2: Run to verify they pass against CURRENT code**

Run: `npx vitest run __tests__/lib/orden-pdf.test.ts`
Expected: PASS. Commit this safety net immediately:

```bash
git add __tests__/lib/orden-pdf.test.ts __tests__/lib/orden-fixture.ts __tests__/pdf-samples.test.ts
git commit -m "test(pdf): add regression coverage for generateOrdenPDF"
```

- [ ] **Step 3: Restyle the client-copy page**

Transformation contract for `generateOrdenPDF` client copy (delete replaced function-local constants — `primaryColor`, `grayColor`, `lightGray`, `bgGray`, `slateLight`, `yellowBg`, `yellowBorder`, `brownColor`, `greenColor`, `greenBg`, and the red problema color — from this function when done; `margin`, `cardGap`, `halfWidth` layout constants stay):

| Current element (explore refs lib/pdf.ts:830-1472) | New treatment |
|---|---|
| 4px indigo top accent bar (899) | DELETE |
| Header: logo + empresa left, order # + dates + indigo "RECEPCIÓN" pill right (903-988) | Same positions. Empresa name bold `MONO.ink`, contact 8pt `MONO.label`. Order `#{numero}` at `TYPE.docNumber` (18pt) bold ink. `drawOutlinedBadge` for the estado pill. Logo keeps its slot |
| Separator + centered "COMPROBANTE DE RECEPCIÓN" 9pt indigo (992-1005) | Solid `drawRule`; title at `TYPE.docTitle` (10pt) bold `MONO.ink`, still centered |
| CLIENTE / EQUIPO cards: white fill, indigo left stripe, bgGray header strip, border (1007-1090) | No cards. `drawSectionLabel` headings, body 9pt ink, same two-column x-positions (`halfWidth`); tipo badge → plain 8pt bold ink text; IMEI stays Courier; dotted `drawRule` below the columns |
| PROBLEMA REPORTADO red accent box (1092-1116) | `drawSectionLabel` + wrapped body 9pt ink; dotted rule below. No box, no red |
| ACCESORIOS yellow box + CÓDIGO DE ACCESO (1118-1188) | Plain sections with `drawSectionLabel`. Pattern-lock grid: same geometry, dots and lines `MONO.ink`; PIN stays Courier in a thin `MONO.rule`-bordered rect (border allowed: it is a table-like frame, not a fill) |
| PRESUPUESTO / SEÑA green box, 16pt amounts (1190-1206) | `MONO.totalBg` filled bar (same slot): labels 6.5pt uppercase `MONO.label`, amounts `TYPE.total` (12pt) bold ink, right-aligned |
| OBSERVACIONES gray box (1208-1231) | Plain section, dotted rule below |
| CHECKLIST card: indigo accent, green/red SI/NO (1233-1315) | Solid rule above; `drawSectionLabel` heading; two-column rows 8pt: item name `MONO.ink`, answer bold ink `SI` / `NO` (no color); free-text items below at 8pt ink |
| QR + FIRMA bgGray box (1317-1400) | No fill. Solid `drawRule` above; QR same size/position; signature image unchanged; signature line = `MONO.ink` 0.5pt line + `Firma del cliente` 6.5pt `MONO.label` |
| TÉRMINOS Y CONDICIONES 6.5pt gray (1402-1450) | Same, `MONO.faint` |
| Footer: indigo bold left, gray right, 6px indigo bottom bar (1452-1462) | `Orden #{numero}` bold `MONO.ink` / `Impreso:` `MONO.faint`; DELETE the bottom bar; keep the thin separator as `drawRule` |
| Dynamic height crop (1464-1472) | UNTOUCHED |

- [ ] **Step 4: Run tests to verify nothing regressed**

Run: `npx vitest run __tests__/lib/orden-pdf.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add lib/pdf.ts
git commit -m "feat(pdf): restyle orden client copy to monochrome typographic design"
```

---

### Task 5: Orden — copia local, fotos and entrega pages

**Files:**
- Modify: `lib/pdf.ts:1474-1911` (remaining blocks of `generateOrdenPDF`)

**Interfaces:**
- Consumes: same `@/lib/pdf-style` exports; Task 4 must be complete (this continues the same function).
- Produces: fully monochrome `generateOrdenPDF` output for all page variants; final page-merge (1789-1871) behavior unchanged.

- [ ] **Step 1: Restyle the remaining blocks**

| Current element (explore refs) | New treatment |
|---|---|
| Copia local compact page (1474-1607): red PROBLEMA stripe, indigo accents | Same density and layout; all accents → `drawSectionLabel` + hairlines; "COPIA LOCAL" heading at `TYPE.docTitle` bold ink; keep its own dynamic height trim |
| FOTOS DE INGRESO page (1607-1667): indigo accent bars, bordered thumbnails | Heading 10pt bold ink + solid rule; thumbnail borders `MONO.rule` 0.5pt; captions 6.5pt `MONO.label` |
| COMPROBANTE DE ENTREGA page (1668-1782): indigo styling, signature boxes | Same structure; headings via `drawSectionLabel`/doc-title style; the two signature boxes → `MONO.rule` 0.5pt outlined rects, labels 6.5pt `MONO.label`, embedded signature PNGs unchanged |
| Cut-line + "✂" between client/local copies (1789-1871) | UNTOUCHED (already neutral dashed line; verify it uses a gray/ink color, adjust to `MONO.label` only if it was indigo) |

Grep-check when done: within `generateOrdenPDF` and `generateFacturaPDF` there must be NO remaining `rgb(` call whose values are outside the `MONO` palette. Run: `rg -n "rgb\(" lib/pdf.ts` and inspect matches falling in lines ~830-1911 and ~3237-3616.

- [ ] **Step 2: Run the full orden + factura test files**

Run: `npx vitest run __tests__/lib/orden-pdf.test.ts` then `npx vitest run __tests__/lib/factura-pdf-venta.test.ts` (sequentially, never concurrent).
Expected: PASS.

- [ ] **Step 3: Generate an ENTREGADO sample to review the entrega page**

Extend `__tests__/pdf-samples.test.ts`: add a third write using `{ ...buildOrdenFixture(), estado: "ENTREGADO", entrega: {...} }` (import `buildOrdenFixture` from `__tests__/lib/orden-fixture.ts`, created in Task 4) → `after-orden-entregada.pdf` (keep it in the file — more coverage, still env-gated).
Run: `PDF_SAMPLES=1 npx vitest run __tests__/pdf-samples.test.ts`
Expected: PASS; three `after-*.pdf` files exist.

- [ ] **Step 4: Commit**

```bash
git add lib/pdf.ts __tests__/pdf-samples.test.ts
git commit -m "feat(pdf): restyle orden local copy, photos and delivery pages monochrome"
```

---

### Task 6: Visual gate + full suite

**Files:**
- None new. Outputs: `.tmp-preview/pdf-samples/before-*.pdf` vs `after-*.pdf`.

- [ ] **Step 1: Run the complete test suite**

Run: `npx vitest run` (single process).
Expected: all green — pre-existing suites unaffected (only `generateOrdenPDF`/`generateFacturaPDF` changed).

- [ ] **Step 2: USER VISUAL GATE (blocking)**

Present the user with the file paths of `before-orden.pdf` / `after-orden.pdf`, `before-remito.pdf` / `after-remito.pdf`, `after-orden-entregada.pdf`. The user opens and approves the look. Apply any feedback (loop back to the relevant task's transformation table) before proceeding. Do NOT open a PR without explicit approval here.

- [ ] **Step 3: Commit any feedback fixes**

```bash
git add lib/pdf.ts
git commit -m "fix(pdf): apply visual feedback to monochrome receipts"
```

(Skip if no feedback.)

---

### Task 7: PR

- [ ] **Step 1: Push and open the PR**

Single PR — the diff is large in lines but is one mechanical restyle of two functions plus tests; splitting orden/remito into chained PRs is possible (Task 3 vs Tasks 4-5 boundaries) if review load demands it — ask the user only if they raise it.

```bash
git push -u origin feat/rediseno-comprobantes-a4
gh pr create --title "feat(pdf): monochrome typographic redesign for orden comprobante and remito" --body "$(cat <<'EOF'
## Summary
- Restyles generateOrdenPDF (recepción comprobante, all sub-pages) to a minimal typographic, pure-grayscale design
- Renames the internal invoice document FACTURA → REMITO (non-fiscal doc; routes/functions unchanged) and restyles it
- Extracts shared style constants to lib/pdf-style.ts (kills per-function rgb() drift)
- Adds first regression tests for generateOrdenPDF + env-gated visual sample generator

Spec: docs/superpowers/specs/2026-08-08-a4-receipts-monochrome-redesign-design.md

## Out of scope (recorded debt)
- Other generators (venta, cotización, garantía, devolución) stay indigo; migrate later onto lib/pdf-style.ts
- "Facturación" UI/menu rename
- Remito pagination on payment-history overflow (still truncates)

## Test plan
- [ ] npx vitest run (full suite, serial)
- [ ] Visual samples approved by user (before/after PDFs)
EOF
)"
```

- [ ] **Step 2: Post-PR check**

Verify PR CI (if any) and report the PR URL to the user.
