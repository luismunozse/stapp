# Remito react-pdf Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the remito's rendering engine with @react-pdf/renderer behind the unchanged `generateFacturaPDF` interface, with an env fallback to the pdf-lib implementation, full content parity, and a ported test suite on a new pdfjs-dist extraction helper.

**Architecture:** New module `lib/remito-react-pdf.tsx` (React component + `generateFacturaPDFReact`), seeded from the spike component (`git show spike/react-pdf-remito:scripts/spike-react-pdf/remito.tsx`). `lib/pdf.ts` keeps everything else; its remito function is renamed `generateFacturaPDFLegacy` and `generateFacturaPDF` becomes a dispatcher (dynamic import of the react module so other PDF consumers don't load react-pdf). Tests for the new engine use a pdfjs-dist text extractor (the pdf-lib-specific helper cannot read react-pdf output).

**Tech Stack:** @react-pdf/renderer ^4.6.1 (prod dep), pdfjs-dist (dev dep, `legacy/build` import), pdf-lib (stays — legacy engine + Helvetica metrics for truncation), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-19-remito-react-pdf-migration-design.md`

## Global Constraints

- Strict TDD: every behavior lands test-first (RED → GREEN → commit).
- `FacturaPDFData` and the `generateFacturaPDF(data): Promise<Buffer>` signature are UNTOUCHED. `app/api/facturacion/[id]/pdf/route.ts` is untouched.
- Font: base-14 `Helvetica` / `Helvetica-Bold` only. No font embedding.
- Letter is **X** + legend `Documento no válido como comprobante fiscal`; `R` (as letter) / `Cód. 91` never rendered.
- Table frames on page breaks keep react-pdf's fragmentation behavior (spec decision — do NOT build a workaround).
- The legacy suite `__tests__/lib/factura-pdf-venta.test.ts` must stay green against `generateFacturaPDFLegacy` — it is the fallback's regression net. Content assertions are never deleted.
- NEVER run two vitest processes concurrently (they kill each other). One command at a time.
- Conventional commits, no AI attribution. Code/comments English. UI strings Spanish as in the component.
- Working directory: worktree `C:\Users\LUIS\Desktop\stapp\.claude\worktrees\remito-formato-clasico`, branch `feat/remito-react-pdf` (from origin/main e5c34f03).

## Key existing code map

- `lib/pdf.ts` — `FacturaPDFData` (~3385-3442), remito generator `generateFacturaPDF` (~3460-4290, becomes Legacy), other generators (do not touch).
- Spike component: `git show spike/react-pdf-remito:scripts/spike-react-pdf/remito.tsx` (484 lines) — already clones header zones, letter box (position:absolute straddle), bands, framed tables with scoped `fixed` headers, money block `wrap={false}`, badge, footer with page numbers, continuación title.
- Spike render harness for reference: `git show spike/react-pdf-remito:scripts/spike-react-pdf/run.ts`.
- Legacy test suite: `__tests__/lib/factura-pdf-venta.test.ts` (38 tests) with `__tests__/lib/pdf-text-helper.ts` (pdf-lib-specific — reads 0 chars from react-pdf output; do not try to reuse for the new engine).
- Route-level suite: `__tests__/api/facturacion-pdf-fiscal.test.ts` — check whether it executes the real generator; if yes, pin it to the legacy engine (see Task 1).
- Samples: `__tests__/pdf-samples.test.ts` (env-gated `PDF_SAMPLES=1`).

---

### Task 1: Dependencies, module skeleton, engine dispatcher

**Files:**
- Modify: `package.json` (+ lockfile) — `@react-pdf/renderer` (dependencies), `pdfjs-dist` (devDependencies)
- Create: `lib/remito-react-pdf.tsx` (seeded from the spike component)
- Modify: `lib/pdf.ts` (rename + dispatcher only)
- Modify: `__tests__/lib/factura-pdf-venta.test.ts` (import switch only)
- Test: `__tests__/lib/remito-react-pdf.test.ts` (new, skeleton)

**Interfaces:**
- Produces: `generateFacturaPDFReact(data: FacturaPDFData): Promise<Buffer>` exported from `lib/remito-react-pdf.tsx`; `generateFacturaPDFLegacy` exported from `lib/pdf.ts`; dispatcher `generateFacturaPDF` honoring `REMITO_PDF_ENGINE=pdflib`.

- [ ] **Step 1: Install deps** — `npm install @react-pdf/renderer` then `npm install -D pdfjs-dist`. Verify lockfile diff contains only these additions.

- [ ] **Step 2: Seed the component** — `git show spike/react-pdf-remito:scripts/spike-react-pdf/remito.tsx > lib/remito-react-pdf.tsx`. Adapt: import `FacturaPDFData` from `./pdf` (export the interface there if it is not already exported); export `generateFacturaPDFReact(data: FacturaPDFData): Promise<Buffer>` that renders the Document via `renderToBuffer` (move any fixture/CLI code out — the spike's run.ts stays behind).

- [ ] **Step 3: Write failing skeleton test** in `__tests__/lib/remito-react-pdf.test.ts` (`// @vitest-environment node` on line 1):

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { PDFDocument } from "pdf-lib"
import { generateFacturaPDFReact } from "@/lib/remito-react-pdf"

const baseData = {
  numeroFactura: "0001-00000008",
  fecha: new Date("2026-08-17"),
  estadoPago: "PAGADO",
  cliente: { nombre: "Consumidor Final" },
  venta: { numeroVenta: 22 },
  subtotal: 3000,
  iva: 0,
  total: 3000,
  montoAbonado: 3000,
  pagos: [],
}

describe("generateFacturaPDFReact — skeleton", () => {
  it("renders a parseable A4 PDF", async () => {
    const buffer = await generateFacturaPDFReact(baseData as any)
    expect(buffer.length).toBeGreaterThan(0)
    const doc = await PDFDocument.load(buffer)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
    const { width, height } = doc.getPage(0).getSize()
    expect(Math.round(width)).toBe(595)
    expect(Math.round(height)).toBe(842)
  })
})
```

- [ ] **Step 4: Run to verify RED** — `npx vitest run __tests__/lib/remito-react-pdf.test.ts`. Expected: FAIL (module doesn't compile/export yet). Fix compile issues until GREEN. This also proves JSX-in-`lib/` compiles under vitest; if esbuild/tsx config complains, fix within vitest config's esbuild options and report it.

- [ ] **Step 5: Dispatcher** — in `lib/pdf.ts`: rename the remito function to `export async function generateFacturaPDFLegacy(...)` (body untouched); add:

```ts
export async function generateFacturaPDF(data: FacturaPDFData): Promise<Buffer> {
  if (process.env.REMITO_PDF_ENGINE === "pdflib") {
    return generateFacturaPDFLegacy(data)
  }
  const { generateFacturaPDFReact } = await import("./remito-react-pdf")
  return generateFacturaPDFReact(data)
}
```

(dynamic import so orden/venta/etc. consumers of lib/pdf.ts never load react-pdf)

- [ ] **Step 6: Keep the legacy net green** — in `__tests__/lib/factura-pdf-venta.test.ts`, switch the import to `generateFacturaPDFLegacy` (mechanical; every call site). Add dispatcher tests to the NEW suite:

```ts
describe("generateFacturaPDF dispatcher", () => {
  it("uses the react engine by default", async () => {
    delete process.env.REMITO_PDF_ENGINE
    const buffer = await generateFacturaPDF(baseData as any)
    const doc = await PDFDocument.load(buffer)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
  })
  it("falls back to pdf-lib when REMITO_PDF_ENGINE=pdflib", async () => {
    process.env.REMITO_PDF_ENGINE = "pdflib"
    try {
      const buffer = await generateFacturaPDF(baseData as any)
      const legacy = await generateFacturaPDFLegacy(baseData as any)
      expect(buffer.length).toBeGreaterThan(0)
      expect(Math.abs(buffer.length - legacy.length)).toBeLessThan(legacy.length * 0.2)
    } finally {
      delete process.env.REMITO_PDF_ENGINE
    }
  })
})
```

(the size-proximity assertion is a cheap engine fingerprint — react output is ~2.5x smaller than pdf-lib's, so a 20% band discriminates the engines without text extraction)

- [ ] **Step 7: Check the route-level suite** — run `npx vitest run __tests__/api/facturacion-pdf-fiscal.test.ts`. If it executes the real generator and fails on the engine switch, pin it: `process.env.REMITO_PDF_ENGINE = "pdflib"` in its setup (with a comment: route contract tests target the legacy net until the react engine owns samples), or adapt if it only asserts on mocks. Report which.

- [ ] **Step 8: Run all touched suites** (one command at a time): `npx vitest run __tests__/lib/remito-react-pdf.test.ts`, then `npx vitest run __tests__/lib/factura-pdf-venta.test.ts`, then the route suite. Expected: ALL PASS. `npx tsc --noEmit` clean.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json lib/remito-react-pdf.tsx lib/pdf.ts __tests__/
git commit -m "feat(pdf): react-pdf remito engine behind generateFacturaPDF dispatcher"
```

---

### Task 2: pdfjs-dist extraction helper

**Files:**
- Create: `__tests__/lib/pdf-text-helper-react.ts`
- Test: extend `__tests__/lib/remito-react-pdf.test.ts`

**Interfaces:**
- Produces: `extractReactPdfText(buffer: Buffer): Promise<string>` and `extractReactPdfTextPositions(buffer: Buffer): Promise<Array<{ text: string; x: number; y: number; page: number }>>` — used by Tasks 3-5.

- [ ] **Step 1: Write failing tests**:

```ts
import { extractReactPdfText, extractReactPdfTextPositions } from "./pdf-text-helper-react"

describe("react-pdf text extraction", () => {
  it("reads text content from react-pdf output", async () => {
    const buffer = await generateFacturaPDFReact(baseData as any)
    const text = await extractReactPdfText(buffer)
    expect(text).toContain("REMITO")
    expect(text).toContain("Documento no válido como comprobante fiscal")
    expect(text).toContain("Consumidor Final")
  })
  it("reports positions with page numbers", async () => {
    const buffer = await generateFacturaPDFReact(baseData as any)
    const items = await extractReactPdfTextPositions(buffer)
    const remito = items.find((i) => i.text.includes("REMITO"))
    expect(remito).toBeDefined()
    expect(remito!.page).toBe(1)
    expect(remito!.y).toBeGreaterThan(600) // upper third of the A4 page
  })
})
```

- [ ] **Step 2: Run to verify RED** — helper module missing.

- [ ] **Step 3: Implement** `__tests__/lib/pdf-text-helper-react.ts`:

```ts
// pdfjs-dist reads react-pdf output (TJ arrays + WinAnsi + nested cm),
// which the pdf-lib-specific ./pdf-text-helper cannot. Legacy build path:
// the standard build requires a worker and DOM APIs vitest's node env lacks.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"

export interface ReactPdfTextItem {
  text: string
  x: number
  y: number
  page: number
}

export async function extractReactPdfTextPositions(buffer: Buffer): Promise<ReactPdfTextItem[]> {
  const doc = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise
  const out: ReactPdfTextItem[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    for (const item of content.items) {
      if ("str" in item && item.str.trim()) {
        out.push({ text: item.str, x: item.transform[4], y: item.transform[5], page: p })
      }
    }
  }
  await doc.destroy()
  return out
}

export async function extractReactPdfText(buffer: Buffer): Promise<string> {
  return (await extractReactPdfTextPositions(buffer)).map((i) => i.text).join("\n")
}
```

(adapt the import to the installed pdfjs-dist version's actual entry point; if `.mjs` import fails under vitest, try `pdfjs-dist/legacy/build/pdf.js` — record which worked)

- [ ] **Step 4: Run to verify GREEN** — `npx vitest run __tests__/lib/remito-react-pdf.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add __tests__/lib/pdf-text-helper-react.ts __tests__/lib/remito-react-pdf.test.ts
git commit -m "test(pdf): pdfjs-dist text extraction helper for react-pdf output"
```

---

### Task 3: Content parity — port the legacy suite's content assertions

**Files:**
- Modify: `lib/remito-react-pdf.tsx` (close every content gap the tests surface)
- Test: extend `__tests__/lib/remito-react-pdf.test.ts`

**Interfaces:**
- Consumes: extractor from Task 2.
- Produces: content-complete component for Tasks 4-5.

- [ ] **Step 1: Read the legacy suite** (`__tests__/lib/factura-pdf-venta.test.ts`) end to end and inventory every CONTENT assertion (ignore coordinate pins — they are legacy-geometry-specific). Port each as a new test against `generateFacturaPDFReact` + `extractReactPdfText`. The inventory MUST cover at least:
  - Letter box: legend present; `Cód. 91`/`COD. 91` absent; standalone bold `X` present (via positions: an item with text exactly "X" on page 1, y in the top band).
  - Fiscal header lines each conditional: `CUIT: …`, `Ingresos brutos: …`, `Inicio actividades: …`, uppercased condición IVA present when set; ALL absent when unset.
  - Dedupe: dirección == domicilio fiscal (post-trim) renders once; different values render both.
  - CLIENTE band: `CUIT/DNI: …` conditional; `VENTA: V0022` padding; `ORDEN: ORD-0008 — Notebook Lenovo`; empty dispositivo → no dangling em-dash; `codigoOrden` null → `#`-number fallback (match legacy format exactly — read its `ordenDisplay`).
  - CONDICIONES: absent for empty org; Vencimiento/Medios de pago/CBU-Alias lines when set; renders ABOVE `DETALLE DE ITEMS` (positions: same page, higher y).
  - Money: Subtotal, conditional IVA/Descuento/Redondeo, TOTAL, `Pagado a cuenta`, `SALDO` vs `SALDO PENDIENTE` label flip at zero, `HISTORIAL DE PAGOS` with running saldo values, `Recibí conforme` only for orden-sourced, estado badge label.
  - Cuotas/recargo note: `3 cuotas · 10% recargo` present when qualifying, absent for `cuotas: 1` / `recargoPorcentaje: 0` (port the legacy boundary-value test).
  - Items table: header order CANT before DESCRIPCIÓN (positions: x compare), items rendered, no `DETALLE DE ITEMS` section when items omitted.

- [ ] **Step 2: Run to verify RED** — some tests will fail where the spike clone is approximate (dedupe, em-dash, note line, `#` fallback are the likely gaps). List which failed in your report.

- [ ] **Step 3: Implement** — close each gap in `lib/remito-react-pdf.tsx`, porting the exact conditional logic from the legacy generator (read the legacy code for each: dedupe comparison via the trimmed values, conditional em-dash suffix, note-line gate `(cuotas > 1) || (recargoPorcentaje > 0)`, `ordenDisplay` fallback, saldo-label flip, running saldo computation).

- [ ] **Step 4: Run to verify GREEN** — full new suite.

- [ ] **Step 5: Commit**

```bash
git add lib/remito-react-pdf.tsx __tests__/lib/remito-react-pdf.test.ts
git commit -m "feat(pdf): content parity for react-pdf remito"
```

---

### Task 4: Truncation clamp (left zone vs letter box)

**Files:**
- Modify: `lib/remito-react-pdf.tsx`
- Test: extend `__tests__/lib/remito-react-pdf.test.ts`

**Interfaces:**
- Consumes: pdf-lib `StandardFonts` (already a dependency).
- Produces: left-zone strings pre-clamped before rendering.

- [ ] **Step 1: Write failing test** (port the legacy clamp test's discrimination style):

```ts
it("clamps long left-zone lines so they never reach the letter box", async () => {
  const longName = "Servicio Técnico Integral de Reparaciones y Mantenimiento S.R.L."
  const buffer = await generateFacturaPDFReact({ ...baseData, nombreEmpresa: longName } as any)
  const text = await extractReactPdfText(buffer)
  expect(text).not.toContain(longName)
  expect(text).toContain("…")
  expect(text).toContain(longName.slice(0, 15)) // truncated prefix survives
})
```

- [ ] **Step 2: Run to verify RED** — spike clone draws the full name (it has no clamp).

- [ ] **Step 3: Implement** — in `lib/remito-react-pdf.tsx`, a metrics helper + pre-clamp:

```ts
import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib"

let helvCache: { regular: PDFFont; bold: PDFFont } | null = null
async function helveticaMetrics() {
  if (!helvCache) {
    const doc = await PDFDocument.create()
    helvCache = {
      regular: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
    }
  }
  return helvCache
}

function truncateToWidth(font: PDFFont, text: string, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text
  let t = text
  while (t.length > 0 && font.widthOfTextAtSize(`${t}…`, size) > maxWidth) t = t.slice(0, -1)
  return `${t}…`
}
```

Call it in `generateFacturaPDFReact` BEFORE rendering: clamp company name (bold metrics) and tel/dirección/domicilio lines (regular metrics) to the same budget the legacy clamp used — the horizontal distance from the left zone's x origin (after the logo width, when a logo is present) to the letter box's left edge minus 10pt; derive the concrete numbers from the component's own StyleSheet values and document them in a comment. Pass the clamped strings as the component's props.

- [ ] **Step 4: Run to verify GREEN** — full new suite.

- [ ] **Step 5: Commit**

```bash
git add lib/remito-react-pdf.tsx __tests__/lib/remito-react-pdf.test.ts
git commit -m "feat(pdf): clamp left-zone text against the letter box in react-pdf remito"
```

---

### Task 5: Pagination acceptance, samples, full regression

**Files:**
- Modify: `lib/remito-react-pdf.tsx` (only if pagination tests surface gaps)
- Modify: `__tests__/pdf-samples.test.ts` (remito fixtures → new engine)
- Test: extend `__tests__/lib/remito-react-pdf.test.ts`

- [ ] **Step 1: Write failing/verifying pagination tests** (port the structural ones):

```ts
it("fits the typical remito on exactly one page", async () => {
  const buffer = await generateFacturaPDFReact(typicalRemito as any) // 3 items + 3 pagos (first with note) + CONDICIONES 3 lines + full fiscal header — copy the acceptance fixture from the legacy suite
  const doc = await PDFDocument.load(buffer)
  expect(doc.getPageCount()).toBe(1)
})

it("paginates a 60-item remito with A4 invariant and repeated headers", async () => {
  const buffer = await generateFacturaPDFReact({ ...baseData, items: manyItems, subtotal: 6000, total: 6000, montoAbonado: 0 } as any)
  const doc = await PDFDocument.load(buffer)
  expect(doc.getPageCount()).toBeGreaterThan(1)
  for (const p of doc.getPages()) expect(Math.round(p.getSize().height)).toBe(842)
  const items = await extractReactPdfTextPositions(buffer)
  const cantHeaders = items.filter((i) => i.text.includes("CANT"))
  expect(new Set(cantHeaders.map((i) => i.page)).size).toBeGreaterThan(1) // header repeats across pages
  expect((await extractReactPdfText(buffer))).toContain("continuación")
})

it("keeps one note line per pago across pagos-table pagination", async () => {
  const pagos = Array.from({ length: 55 }, (_, i) => ({ monto: 100, metodoPago: "TARJETA_CREDITO", fecha: new Date("2026-08-17"), referencia: `REF-${String(i + 1).padStart(3, "0")}`, cuotas: 3, recargoPorcentaje: 10 }))
  const buffer = await generateFacturaPDFReact({ ...baseData, pagos, montoAbonado: 5500 } as any)
  const items = await extractReactPdfTextPositions(buffer)
  expect(items.filter((i) => i.text.includes("cuotas")).length).toBe(55)
})

it("numbers every page in the footer", async () => {
  const buffer = await generateFacturaPDFReact({ ...baseData, items: manyItems } as any)
  const text = await extractReactPdfText(buffer)
  expect(text).toMatch(/Página 1 de \d+/)
})
```

If the one-page acceptance FAILS because the react layout is taller, compress the component's vertical spacing (margins/padding in the StyleSheet) until it fits — same levers as the pdf-lib compaction, CSS-side. Do not shrink font sizes.

- [ ] **Step 2: RED where expected → implement → GREEN.**

- [ ] **Step 3: Samples** — in `__tests__/pdf-samples.test.ts`, route the remito fixtures through `generateFacturaPDF` (the dispatcher, i.e. the react engine) while other documents keep their generators. Run `PDF_SAMPLES=1 PDF_SAMPLES_TAG=reactpdf npx vitest run __tests__/pdf-samples.test.ts`; rasterize and eyeball both remito samples (one-page + largo); report paths and verdict.

- [ ] **Step 4: Full regression** — `npm run test:run` ONCE. ALL green (legacy suite included). `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(pdf): react-pdf remito pagination acceptance and samples"
```

---

## Delivery note (for the finishing step, not for task executors)

Single PR is acceptable despite size if most lines are tests + the seeded component (already user-approved visually); decide at finishing time. The dispatcher env `REMITO_PDF_ENGINE=pdflib` is the rollback story — document it in the PR body.
