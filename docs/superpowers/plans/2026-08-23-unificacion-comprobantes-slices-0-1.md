# Unificación de comprobantes — Slices 0 y 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the CI net that catches bundle-level PDF failures, then extract the shared document shell and prove it against the three documents that are already react-pdf.

**Architecture:** Slice 0 adds a CI-only route that renders every react-pdf document from fixtures inside a real production build, plus a script that asserts it. Slice 1 moves the pieces that `lib/cuenta-corriente-react-pdf.tsx` already grew (`CabeceraCC`, `PieCC`, tokens, the saldo headline) into `lib/pdf-react-shell.tsx`, generalises the header so it serves both the remito's letter-box geometry and the recibo's simpler one, and has all three documents adopt it.

**Tech Stack:** Next 16 (App Router), React 19.2, `@react-pdf/renderer` 4.6, vitest, pdfjs-dist for text extraction, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-23-unificacion-comprobantes-design.md`

## Global Constraints

- **Engine: `@react-pdf/renderer` only.** No new pdf-lib code. `pdf-lib` stays imported only for text measurement (`StandardFonts` metrics) and in `lib/pdf.ts`, untouched by this plan.
- **React floor: 19.2.** `__tests__/lib/react-pdf-reconciler-match.test.ts` enforces it. Never lower `react`/`react-dom` below `^19.2.0`.
- **Document geometry stays out of `lib/pdf-react-shared.ts`.** That file holds only geometry-free primitives (tokens, `safe`, `fetchLogo`, Helvetica metrics, `truncateToWidth`). Layout pieces go in the new `lib/pdf-react-shell.tsx`.
- **Single fiscal legend.** After Task 3, the string "no válido como comprobante fiscal" exists in exactly one place, `LEYENDA_NO_FISCAL`.
- **A4 only.** The thermal ticket (`generateVentaTicketPDF`) and ESC/POS are out of scope; do not import shell pieces there.
- **Text assertions use the pdfjs extractor** (`__tests__/lib/pdf-text-helper-react.ts`), never `./pdf-text-helper`. pdfjs reads both engines; the pdf-lib helper cannot read react-pdf output.
- **Currency assertions must normalise NBSP.** `Intl` emits U+00A0 / U+202F where react-pdf writes a plain space. Copy the `normalize` helper from `__tests__/lib/cuenta-corriente-react-pdf.test.ts` — do not type a literal NBSP into source, write the ` ` escape.
- **Never `sed` a `\uXXXX` escape into a file.** GNU sed treats `\u` as an uppercase-conversion escape and eats it. Use node or an editor.

---

## Task 1: CI-only PDF smoke route

Renders every react-pdf document from fixtures with no database, no auth and no tenant — the exact conditions under which React error #31 reproduced. Returns per-document byte counts.

**Files:**
- Create: `app/api/public/pdf-smoke/route.ts`
- Test: `__tests__/api/pdf-smoke-route.test.ts`

**Interfaces:**
- Consumes: `generateFacturaPDFReact` from `lib/remito-react-pdf`, `generateReciboCCPDF` and `generateResumenCCPDF` from `lib/cuenta-corriente-react-pdf`.
- Produces: `GET /api/public/pdf-smoke` → `200 {"ok":true,"documentos":{"remito":number,"reciboCC":number,"resumenCC":number}}` when `process.env.PDF_SMOKE === "1"`; `404 {"error":"Not found"}` otherwise. Task 2's script depends on this exact shape.

Two traps, both hit while reproducing #31 — the route path is chosen around them:
- Next never routes a directory whose name starts with an underscore. `pdf-smoke`, not `__pdf-smoke`.
- The middleware redirects everything outside `/api/public` to `/login` (see `middleware.ts`, `publicPaths`). It must live under `/api/public`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/api/pdf-smoke-route.test.ts
// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest"

afterEach(() => {
  delete process.env.PDF_SMOKE
  vi.resetModules()
})

describe("GET /api/public/pdf-smoke", () => {
  it("404s when the smoke flag is not set, so production never exposes it", async () => {
    const { GET } = await import("@/app/api/public/pdf-smoke/route")
    const res = await GET()
    expect(res.status).toBe(404)
  })

  it("renders every react-pdf document when the flag is set", async () => {
    process.env.PDF_SMOKE = "1"
    const { GET } = await import("@/app/api/public/pdf-smoke/route")
    const res = await GET()
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.ok).toBe(true)
    // Every document must render to a real PDF, not an empty buffer.
    for (const [nombre, bytes] of Object.entries(body.documentos)) {
      expect(bytes, `${nombre} rendered nothing`).toBeGreaterThan(1000)
    }
    expect(Object.keys(body.documentos).sort()).toEqual(["reciboCC", "remito", "resumenCC"])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/pdf-smoke-route.test.ts`
Expected: FAIL — `Cannot find package '@/app/api/public/pdf-smoke/route'`

- [ ] **Step 3: Write the route**

```ts
// app/api/public/pdf-smoke/route.ts
import { NextResponse } from "next/server"
import { generateFacturaPDFReact } from "@/lib/remito-react-pdf"
import { generateReciboCCPDF, generateResumenCCPDF } from "@/lib/cuenta-corriente-react-pdf"

// CI-only. Renders every react-pdf document from fixtures inside a real
// production bundle — no database, no auth, no tenant. That is exactly the
// setup under which React error #31 reproduced (see the #323 postmortem in
// the design doc): the failure is in the bundle, not in the data.
//
// Gated on PDF_SMOKE, which only the CI Build job sets. Production never
// sets it, so this route is a 404 there.
export const dynamic = "force-dynamic"

const FECHA = new Date("2026-08-20T15:00:00Z")

const EMISOR = {
  nombreEmpresa: "Smoke Test SRL",
  telefonoEmpresa: "+54 11 4000-0000",
  direccionEmpresa: "Av. Siempreviva 742",
  cuitEmpresa: "20123456789",
  condicionIvaEmpresa: "Responsable Inscripto",
  moneda: "ARS",
  zonaHoraria: "America/Argentina/Buenos_Aires",
}

export async function GET() {
  if (process.env.PDF_SMOKE !== "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  try {
    const [remito, reciboCC, resumenCC] = await Promise.all([
      generateFacturaPDFReact({
        ...EMISOR,
        numeroFactura: "0001-00000001",
        fecha: FECHA,
        estadoPago: "PAGADO",
        cliente: { nombre: "Cliente Smoke" },
        venta: { numeroVenta: 1 },
        items: [{ descripcion: "Item smoke", cantidad: 1, precioUnitario: 1000, subtotal: 1000 }],
        subtotal: 1000,
        iva: 0,
        total: 1000,
        montoAbonado: 1000,
        pagos: [{ fecha: FECHA, metodoPago: "EFECTIVO", monto: 1000, referencia: "" }],
      } as never),

      generateReciboCCPDF({
        ...EMISOR,
        numeroRecibo: "REC-00001",
        fecha: FECHA,
        tipo: "DEPOSITO",
        monto: 1000,
        saldoPosterior: 1000,
        metodoPago: "EFECTIVO",
        cliente: { nombre: "Cliente Smoke" },
      }),

      generateResumenCCPDF({
        ...EMISOR,
        desde: "2026-08-01",
        hasta: "2026-08-31",
        saldoInicial: 0,
        saldoFinal: 1000,
        movimientos: [
          { fecha: FECHA, tipo: "DEPOSITO", monto: 1000, saldoPosterior: 1000, metodoPago: "EFECTIVO" },
        ],
        cliente: { nombre: "Cliente Smoke" },
      }),
    ])

    return NextResponse.json({
      ok: true,
      documentos: {
        remito: remito.length,
        reciboCC: reciboCC.length,
        resumenCC: resumenCC.length,
      },
    })
  } catch (error) {
    // The whole point: surface the real error instead of a generic 500, so CI
    // logs name the failure the way the Vercel logs eventually named #31.
    console.error("pdf-smoke failed:", error)
    return NextResponse.json(
      { ok: false, error: (error as Error).message, stack: (error as Error).stack?.split("\n").slice(0, 8) },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/api/pdf-smoke-route.test.ts`
Expected: PASS, 2 tests

- [ ] **Step 5: Verify the fixtures match the real data shapes**

Run: `npx tsc --noEmit`
Expected: no errors. If `FacturaPDFData` rejects the remito fixture, fix the fixture to match the type — do not widen the type and do not reach for `as never` beyond the one cast already shown (it exists because `FacturaPDFData` has many optional branches the smoke fixture does not exercise).

- [ ] **Step 6: Commit**

```bash
git add app/api/public/pdf-smoke/route.ts __tests__/api/pdf-smoke-route.test.ts
git commit -m "test(pdf): ruta de smoke que renderiza los documentos react-pdf en CI"
```

---

## Task 2: Smoke script and CI wiring

The route alone proves nothing until something runs it inside a production build. This task is what would have caught React #31 before merge.

**Files:**
- Create: `scripts/pdf-smoke.mjs`
- Modify: `.github/workflows/ci.yml` (the `build` job — it already runs `next build` with mock env vars, so no second build)

**Interfaces:**
- Consumes: `GET /api/public/pdf-smoke` from Task 1.
- Produces: `node scripts/pdf-smoke.mjs` → exit 0 when every document rendered over 1000 bytes; exit 1 with the server's error printed otherwise.

- [ ] **Step 1: Write the script**

There is no unit test for this one: its whole value is the integration it performs, and a mocked version would assert nothing real. It is verified by running it (Step 2) and by CI itself.

```js
// scripts/pdf-smoke.mjs
// Boots the production build and renders every react-pdf document.
//
// Why this exists: neither test layer can see a bundle-level failure. Vitest
// never compiles with Next; Playwright compiles with Next but points at
// `npm run dev` (playwright.config.ts). React error #31 went between the two
// and shipped every PDF route broken. This closes that gap.
import { spawn } from "node:child_process"

const PORT = process.env.PDF_SMOKE_PORT || "3977"
const URL = `http://127.0.0.1:${PORT}/api/public/pdf-smoke`
const MIN_BYTES = 1000
const BOOT_TIMEOUT_MS = 90_000

const server = spawn("npx", ["next", "start", "-p", PORT], {
  env: { ...process.env, PDF_SMOKE: "1" },
  stdio: ["ignore", "inherit", "inherit"],
  shell: process.platform === "win32",
})

const shutdown = () => {
  if (!server.killed) server.kill()
}
process.on("exit", shutdown)

const fail = (msg) => {
  console.error(`\n✗ pdf-smoke: ${msg}`)
  shutdown()
  process.exit(1)
}

const deadline = Date.now() + BOOT_TIMEOUT_MS
let body = null

while (Date.now() < deadline) {
  try {
    const res = await fetch(URL)
    body = await res.json()
    if (res.status === 404) fail("the route 404'd — PDF_SMOKE did not reach the server process")
    if (!res.ok) {
      console.error(body)
      fail(`the server returned ${res.status}: ${body?.error ?? "unknown error"}`)
    }
    break
  } catch {
    // Server not up yet. `next start` needs a few seconds.
    await new Promise((r) => setTimeout(r, 1000))
  }
}

if (!body) fail(`the server never answered within ${BOOT_TIMEOUT_MS / 1000}s`)

const documentos = body.documentos ?? {}
const nombres = Object.keys(documentos)
if (nombres.length === 0) fail("the route rendered no documents at all")

for (const [nombre, bytes] of Object.entries(documentos)) {
  if (typeof bytes !== "number" || bytes < MIN_BYTES) {
    fail(`${nombre} rendered ${bytes} bytes, expected more than ${MIN_BYTES}`)
  }
  console.log(`  ✓ ${nombre}: ${bytes} bytes`)
}

console.log(`\n✓ pdf-smoke: ${nombres.length} documentos renderizados en un build de produccion`)
shutdown()
process.exit(0)
```

- [ ] **Step 2: Run it locally against a real build**

```bash
npm run build
node scripts/pdf-smoke.mjs
```

Expected: three `✓` lines and exit 0. If it hangs, the server is probably still booting — the script already waits 90s. If it 404s, `PDF_SMOKE` is not reaching the child process.

- [ ] **Step 3: Prove the script actually fails when rendering breaks**

A green check that cannot go red is decoration. Temporarily break the render and confirm the script catches it:

```bash
# In app/api/public/pdf-smoke/route.ts, temporarily replace the remito
# fixture's `total: 1000` with `total: undefined as never` — or simply throw
# at the top of the try block — then:
npm run build && node scripts/pdf-smoke.mjs
```

Expected: exit 1, with the server's error message printed. Revert the change and re-run to confirm green again.

- [ ] **Step 4: Add the script to package.json**

```json
"pdf:smoke": "node scripts/pdf-smoke.mjs"
```

Insert it after the `"test:e2e:install:all"` entry to keep test-ish scripts together.

- [ ] **Step 5: Wire it into the CI build job**

In `.github/workflows/ci.yml`, inside the `build` job, add a step immediately after the existing build step. The job already sets the mock env vars and already runs `next build`, so this reuses both:

```yaml
      - name: PDF render smoke (production bundle)
        run: node scripts/pdf-smoke.mjs
        env:
          PDF_SMOKE: '1'
```

- [ ] **Step 6: Commit**

```bash
git add scripts/pdf-smoke.mjs package.json .github/workflows/ci.yml
git commit -m "ci(pdf): chequear el render de PDFs contra el build de produccion"
```

- [ ] **Step 7: Open the PR and confirm the check runs**

The step must appear in the Build job's log with the three `✓` lines. A step that silently skips is worse than no step.

---

## Task 3: Shell foundation — legend and footer

Smallest possible first cut of `lib/pdf-react-shell.tsx`: the fiscal legend (three wordings today) and the footer. Both documents adopt it.

**Files:**
- Create: `lib/pdf-react-shell.tsx`
- Create: `__tests__/lib/pdf-react-shell.test.tsx`
- Modify: `lib/cuenta-corriente-react-pdf.tsx` (delete local `PieCC`, import `Pie`)
- Modify: `lib/remito-react-pdf.tsx` (delete the inline footer JSX and `LEGEND_TEXT`)

**Interfaces:**
- Consumes: `MONO`, `TYPE`, `RULE_WIDTH` from `lib/pdf-react-shared`.
- Produces:
  - `LEYENDA_NO_FISCAL: string` — `"Documento no válido como comprobante fiscal"`
  - `leyendaPie(documento: string): string` — `"{documento} — no válido como comprobante fiscal."`
  - `<Pie leyenda={string} fechaImpresion={string} />` — absolute footer, `fixed`, with rule, legend, print timestamp and `Página N de M` when there is more than one page.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/lib/pdf-react-shell.test.tsx
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { LEYENDA_NO_FISCAL, leyendaPie } from "@/lib/pdf-react-shell"

describe("legend", () => {
  it("states the non-fiscal legend once, for every document to reuse", () => {
    expect(LEYENDA_NO_FISCAL).toBe("Documento no válido como comprobante fiscal")
  })

  it("builds a footer legend naming the document", () => {
    expect(leyendaPie("Recibo interno de cuenta corriente")).toBe(
      "Recibo interno de cuenta corriente — no válido como comprobante fiscal."
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/pdf-react-shell.test.tsx`
Expected: FAIL — `Cannot find package '@/lib/pdf-react-shell'`

- [ ] **Step 3: Create the shell with the legend and the footer**

```tsx
// lib/pdf-react-shell.tsx
// Layout pieces shared by the A4 documents rendered with @react-pdf/renderer.
//
// The split against lib/pdf-react-shared.ts is deliberate: that file holds
// primitives with NO geometry (tokens, safe, fetchLogo, Helvetica metrics,
// truncateToWidth). Anything that draws or positions lives here.
//
// Out of scope by design: the thermal ticket (58/80mm) and ESC/POS. They are
// a different medium — 32 characters wide, no fonts, no layout.
import * as React from "react"
import { View, Text, StyleSheet } from "@react-pdf/renderer"
import { MONO, TYPE, RULE_WIDTH } from "./pdf-react-shared"

/** The one wording. Previously written three different ways across engines. */
export const LEYENDA_NO_FISCAL = "Documento no válido como comprobante fiscal"

/** Footer variant: names the document, then the legend. */
export const leyendaPie = (documento: string) =>
  `${documento} — no válido como comprobante fiscal.`

// Named `estilosShell` and exported from the start: Tasks 4-7 add to this same
// object, and documents compose their own rows against it.
export const estilosShell = StyleSheet.create({
  footer: { position: "absolute", bottom: 40, left: 40, right: 40 },
  footerRule: { borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.rule },
  footerDisclaimer: { fontSize: TYPE.fine, color: MONO.faint, marginTop: 8 },
  footerRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  footerFine: { fontSize: 7, color: MONO.faint },
  footerPageNum: { fontSize: TYPE.small, color: MONO.faint },
})

export function Pie({ leyenda, fechaImpresion }: { leyenda: string; fechaImpresion: string }) {
  return (
    <View style={estilosShell.footer} fixed>
      <View style={estilosShell.footerRule} />
      <Text style={estilosShell.footerDisclaimer}>{leyenda}</Text>
      <View style={estilosShell.footerRow}>
        <Text style={estilosShell.footerFine}>Impreso: {fechaImpresion}</Text>
        <Text
          style={estilosShell.footerPageNum}
          render={({ pageNumber, totalPages }) => (totalPages > 1 ? `Página ${pageNumber} de ${totalPages}` : "")}
        />
      </View>
    </View>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/pdf-react-shell.test.tsx`
Expected: PASS, 2 tests

- [ ] **Step 5: Have cuenta corriente adopt it**

In `lib/cuenta-corriente-react-pdf.tsx`: delete the local `PieCC` function and the footer entries from its `StyleSheet` (`footer`, `footerRule`, `footerDisclaimer`, `footerRow`, `footerFine`, `footerPageNum`). Import `Pie` and `leyendaPie` from `./pdf-react-shell`. Replace both call sites:

```tsx
<Pie
  leyenda={leyendaPie("Recibo interno de cuenta corriente")}
  fechaImpresion={formatDateTimeValue(new Date(), tz)}
/>
```

and

```tsx
<Pie
  leyenda={leyendaPie("Resumen interno de cuenta corriente")}
  fechaImpresion={formatDateTimeValue(new Date(), tz)}
/>
```

- [ ] **Step 6: Have the remito adopt it**

In `lib/remito-react-pdf.tsx`: replace the inline footer `<View style={styles.footer} fixed>…</View>` with `<Pie leyenda={leyendaPie("Remito interno")} fechaImpresion={fechaImpresion} />`, delete the same six footer style entries, and replace the `LEGEND_TEXT` constant with `LEYENDA_NO_FISCAL` imported from the shell (its long derivation comment stays — the clamp geometry still depends on that string's rendered width).

- [ ] **Step 7: Run the affected suites**

Run: `npx vitest run __tests__/lib/pdf-react-shell.test.tsx __tests__/lib/cuenta-corriente-react-pdf.test.ts __tests__/lib/cuenta-corriente-resumen-pdf.test.ts __tests__/lib/remito-react-pdf.test.ts`
Expected: PASS, 54 tests. These already assert the legend text and the footer, so they are the regression check for this move — no new assertions needed.

- [ ] **Step 8: Confirm the legend now exists once**

Run: `rg -n "no válido como comprobante fiscal" lib/`
Expected: exactly two hits, both in `lib/pdf-react-shell.tsx` (`LEYENDA_NO_FISCAL` and `leyendaPie`). Any hit in `lib/remito-react-pdf.tsx` or `lib/cuenta-corriente-react-pdf.tsx` means a call site was missed. `lib/pdf.ts` will still have its own — that file is out of scope until slices 2-7.

- [ ] **Step 9: Commit**

```bash
git add lib/pdf-react-shell.tsx __tests__/lib/pdf-react-shell.test.tsx lib/cuenta-corriente-react-pdf.tsx lib/remito-react-pdf.tsx
git commit -m "refactor(pdf): mover el pie y la leyenda fiscal al shell compartido"
```

---

## Task 4: Shell — Seccion, FilaDetalle, BarraTotal, Badge

The small structural pieces. Extracted before the header because they carry no geometry decisions, so they shake out the shell's import surface cheaply.

**Files:**
- Modify: `lib/pdf-react-shell.tsx`
- Modify: `__tests__/lib/pdf-react-shell.test.tsx`
- Modify: `lib/cuenta-corriente-react-pdf.tsx`
- Modify: `lib/remito-react-pdf.tsx`

**Interfaces:**
- Produces:
  - `<Seccion titulo={string} children />` — uppercase label plus the section body.
  - `<FilaDetalle label={string} valor={string} />` — label left, value right, bottom rule.
  - `<BarraTotal label={string} valor={string} />` — the grey headline bar.
  - `<Badge texto={string} />` — outlined state badge.
  - `estilosShell` — the `StyleSheet` object, exported so documents can compose their own rows against the same tokens (`estilosShell.hr`, `estilosShell.sectionLabel`).

- [ ] **Step 1: Write the failing test**

```tsx
// append to __tests__/lib/pdf-react-shell.test.tsx
import { Document, Page, renderToBuffer } from "@react-pdf/renderer"
import { Seccion, FilaDetalle, BarraTotal, Badge } from "@/lib/pdf-react-shell"
import { extractReactPdfText } from "./pdf-text-helper-react"

const render = (children: React.ReactNode) =>
  renderToBuffer(
    <Document>
      <Page size="A4">{children}</Page>
    </Document>
  )

describe("structural pieces", () => {
  it("uppercases the section label and keeps its body", async () => {
    const text = await extractReactPdfText(
      await render(
        <Seccion titulo="Detalle del movimiento">
          <FilaDetalle label="Concepto" valor="Depósito" />
        </Seccion>
      )
    )
    expect(text).toContain("DETALLE DEL MOVIMIENTO")
    expect(text).toContain("Concepto")
    expect(text).toContain("Depósito")
  })

  it("renders the total bar and the badge", async () => {
    const text = await extractReactPdfText(
      await render(
        <>
          <BarraTotal label="SALDO A FAVOR" valor="$ 1.000,00" />
          <Badge texto="PAGADO" />
        </>
      )
    )
    expect(text).toContain("SALDO A FAVOR")
    expect(text).toContain("$ 1.000,00")
    expect(text).toContain("PAGADO")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/pdf-react-shell.test.tsx`
Expected: FAIL — `Seccion is not exported`

- [ ] **Step 3: Add the pieces to the shell**

Add to `lib/pdf-react-shell.tsx`, extending the `estilosShell` object created in Task 3:

```tsx
// Added to the object Task 3 created — the footer entries stay.
export const estilosShell = StyleSheet.create({
  hr: { borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.rule },
  sectionLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: TYPE.sectionLabel,
    color: MONO.label,
    textTransform: "uppercase",
  },
  seccion: { marginTop: 14 },
  seccionBody: { marginTop: 8 },
  filaDetalle: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: RULE_WIDTH,
    borderBottomColor: MONO.rule,
    paddingVertical: 3,
  },
  filaLabel: { fontSize: TYPE.body, color: MONO.label },
  filaValor: { fontSize: TYPE.body, textAlign: "right" },
  barraTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: MONO.totalBg,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginTop: 4,
  },
  barraLabel: { fontFamily: "Helvetica-Bold", fontSize: TYPE.total },
  barraValor: { fontFamily: "Helvetica-Bold", fontSize: TYPE.total },
  badge: { borderWidth: 0.75, borderColor: MONO.ink, paddingHorizontal: 5, paddingVertical: 3.5, alignSelf: "flex-start" },
  badgeText: { fontFamily: "Helvetica-Bold", fontSize: 7 },
})

export function Seccion({ titulo, children }: { titulo: string; children?: React.ReactNode }) {
  return (
    <View style={estilosShell.seccion}>
      <Text style={estilosShell.sectionLabel}>{titulo}</Text>
      <View style={estilosShell.seccionBody}>{children}</View>
    </View>
  )
}

export function FilaDetalle({ label, valor }: { label: string; valor: string }) {
  return (
    <View style={estilosShell.filaDetalle}>
      <Text style={estilosShell.filaLabel}>{label}</Text>
      <Text style={estilosShell.filaValor}>{valor}</Text>
    </View>
  )
}

export function BarraTotal({ label, valor }: { label: string; valor: string }) {
  return (
    <View style={estilosShell.barraTotal} wrap={false}>
      <Text style={estilosShell.barraLabel}>{label}</Text>
      <Text style={estilosShell.barraValor}>{valor}</Text>
    </View>
  )
}

export function Badge({ texto }: { texto: string }) {
  return (
    <View style={estilosShell.badge}>
      <Text style={estilosShell.badgeText}>{texto}</Text>
    </View>
  )
}
```

Note `textTransform: "uppercase"` on `sectionLabel`: `drawSectionLabel` in `lib/pdf-style.ts` uppercases in code, so the six mixed-case labels in `lib/pdf.ts` ("Recibí conforme", "Condiciones de pago") already render uppercase today. Keeping the transform in the style preserves that output exactly.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/pdf-react-shell.test.tsx`
Expected: PASS, 4 tests

- [ ] **Step 5: Adopt in both documents**

In `lib/cuenta-corriente-react-pdf.tsx`, replace the local `detalleRow` / `detalleLabel` / `detalleValue` / `saldoBar` / `saldoLabel` / `saldoValue` / `sectionLabel` / `hr` usages with `FilaDetalle`, `BarraTotal` and `Seccion`, deleting those style entries. In `lib/remito-react-pdf.tsx`, do the same for its `detalleRow`, `totalRow`, `saldoBar` and `badge` blocks.

Do not convert the remito's items or pagos tables here — those are Task 7.

- [ ] **Step 6: Run the affected suites**

Run: `npx vitest run __tests__/lib/pdf-react-shell.test.tsx __tests__/lib/cuenta-corriente-react-pdf.test.ts __tests__/lib/cuenta-corriente-resumen-pdf.test.ts __tests__/lib/remito-react-pdf.test.ts`
Expected: PASS, 56 tests. Any failure here is a real content change — the existing assertions cover these rows.

- [ ] **Step 7: Commit**

```bash
git add lib/pdf-react-shell.tsx __tests__/lib/pdf-react-shell.test.tsx lib/cuenta-corriente-react-pdf.tsx lib/remito-react-pdf.tsx
git commit -m "refactor(pdf): mover seccion, fila de detalle, barra de total y badge al shell"
```

---

## Task 5: Shell — Cabecera and BandaCliente

The crux of slice 1. Both documents draw the same header, but their truncation budgets are derived differently: the remito's left zone must clear a centered letter box AND a centered legend; the recibo's only competes with the right zone. Both derivations move into the shell as named functions, so the geometry stays documented and testable instead of duplicated.

**Files:**
- Modify: `lib/pdf-react-shell.tsx`
- Modify: `__tests__/lib/pdf-react-shell.test.tsx`
- Modify: `lib/cuenta-corriente-react-pdf.tsx`
- Modify: `lib/remito-react-pdf.tsx`

**Interfaces:**
- Consumes: `PAGE_WIDTH_A4`, `truncateToWidth`, `HelveticaMetrics`, `PdfLogo`, `safe` from `lib/pdf-react-shared`.
- Produces:
  - `EmisorData` — `{ nombreEmpresa?, telefonoEmpresa?, direccionEmpresa?, domicilioFiscalEmpresa?, cuitEmpresa?, condicionIvaEmpresa?, ingresosBrutosEmpresa?, inicioActividadesEmpresa?, logoUrl? }`, all `string | null | undefined`.
  - `DocumentoBase` — `EmisorData & { cliente: ClienteData; moneda?: string | null; zonaHoraria?: string | null; sucursalNombre?: string | null; atendidoPor?: string | null }`. This is the spec's "interface every document's type extends": `ReciboCCPDFData`, `ResumenCCPDFData` and each later migrated document extend it instead of redeclaring these fields. It replaces `CuentaCorrienteEmisor` in `lib/cuenta-corriente-react-pdf.tsx`.
  - `ClienteData` — `{ nombre?, dni?, telefono?, email?, direccion? }`, all `string | null | undefined`.
  - `presupuestoZonaIzquierda(opts: { logo: boolean; letterBox: boolean; metrics: HelveticaMetrics }): number` — returns the truncation budget in points.
  - `<Cabecera emisor metrics logo titulo numero lineasDerecha letterBox />` — `letterBox?: string` renders the straddling box with that letter plus the centered legend; omitted, neither.
  - `<BandaCliente label cliente derecha />` — `derecha?: React.ReactNode` is the free slot.

- [ ] **Step 1: Write the failing test**

The budget functions are the part worth testing directly — the JSX is covered by the documents' own suites.

```tsx
// append to __tests__/lib/pdf-react-shell.test.tsx
import { presupuestoZonaIzquierda, Cabecera, BandaCliente } from "@/lib/pdf-react-shell"
import { helveticaMetrics } from "@/lib/pdf-react-shared"

describe("left-zone truncation budget", () => {
  it("is tighter with a letter box than without, because the legend sits further left", async () => {
    const metrics = await helveticaMetrics()
    const conCaja = presupuestoZonaIzquierda({ logo: false, letterBox: true, metrics })
    const sinCaja = presupuestoZonaIzquierda({ logo: false, letterBox: false, metrics })
    expect(conCaja).toBeLessThan(sinCaja)
  })

  it("shrinks by the logo box and its gap when a logo is present", async () => {
    const metrics = await helveticaMetrics()
    const conLogo = presupuestoZonaIzquierda({ logo: true, letterBox: true, metrics })
    const sinLogo = presupuestoZonaIzquierda({ logo: false, letterBox: true, metrics })
    expect(sinLogo - conLogo).toBe(95) // LOGO_BOX_WIDTH 80 + LOGO_GAP 15
  })
})

describe("Cabecera", () => {
  it("renders the letter box and the legend only when asked", async () => {
    const metrics = await helveticaMetrics()
    const emisor = { nombreEmpresa: "Empresa Shell" }

    const conCaja = await extractReactPdfText(
      await render(<Cabecera emisor={emisor} metrics={metrics} titulo="REMITO" numero="0001-0001" letterBox="X" />)
    )
    expect(conCaja).toContain("X")
    expect(conCaja).toContain(LEYENDA_NO_FISCAL)

    const sinCaja = await extractReactPdfText(
      await render(<Cabecera emisor={emisor} metrics={metrics} titulo="RECIBO" numero="REC-00001" />)
    )
    expect(sinCaja).toContain("RECIBO")
    expect(sinCaja).not.toContain(LEYENDA_NO_FISCAL)
  })
})

describe("BandaCliente", () => {
  it("prints the cliente and whatever the document puts on the right", async () => {
    const text = await extractReactPdfText(
      await render(
        <BandaCliente
          label="Recibimos de"
          cliente={{ nombre: "Juan Pérez", dni: "20123456" }}
          derecha={<Text>VENTA: V0020</Text>}
        />
      )
    )
    expect(text).toContain("RECIBIMOS DE")
    expect(text).toContain("Juan Pérez")
    expect(text).toContain("20123456")
    expect(text).toContain("VENTA: V0020")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/pdf-react-shell.test.tsx`
Expected: FAIL — `presupuestoZonaIzquierda is not exported`

- [ ] **Step 3: Move the geometry constants and the budget function into the shell**

Copy the constants and their derivation comments verbatim from `lib/remito-react-pdf.tsx` (`LOGO_BOX_WIDTH`, `LOGO_BOX_HEIGHT`, `LOGO_GAP`, `LEFT_ZONE_X`, `LETTER_BOX_X`, `LETTER_BOX_GAP`) and from `lib/cuenta-corriente-react-pdf.tsx` (`RIGHT_ZONE_WIDTH`, `HEADER_GAP`, `CONTENT_WIDTH`, `LEFT_ZONE_BUDGET`). Those comments explain where each number comes from; losing them turns the file into magic numbers.

```tsx
const LOGO_BOX_WIDTH = 80
const LOGO_BOX_HEIGHT = 50
const LOGO_GAP = 15
const LEFT_ZONE_X = 40 + 10
const LETTER_BOX_GAP = 10
const LETTER_BOX_WIDTH = 34
const LETTER_BOX_X = PAGE_WIDTH_A4 / 2 - LETTER_BOX_WIDTH / 2
const RIGHT_ZONE_WIDTH = 190
const HEADER_GAP = 14
const CONTENT_WIDTH = PAGE_WIDTH_A4 - 40 - 40 - RULE_WIDTH * 2 - 10 * 2

/**
 * Truncation budget for the header's left zone, in points.
 *
 * With a letter box the competitor is the centered legend, not the box: at
 * TYPE.fine the legend measures ~135pt, so its left edge sits further left
 * than the box's. Without one, the only competitor is the right zone.
 *
 * Shrinks by the logo box plus its gap when a logo is present, because the
 * text column is pushed right by exactly that much.
 */
export function presupuestoZonaIzquierda({
  logo,
  letterBox,
  metrics,
}: {
  logo: boolean
  letterBox: boolean
  metrics: HelveticaMetrics
}): number {
  const x = LEFT_ZONE_X + (logo ? LOGO_BOX_WIDTH + LOGO_GAP : 0)

  if (!letterBox) return CONTENT_WIDTH - RIGHT_ZONE_WIDTH - HEADER_GAP - (logo ? LOGO_BOX_WIDTH + LOGO_GAP : 0)

  const hastaLaCaja = LETTER_BOX_X - LETTER_BOX_GAP - x
  const anchoLeyenda = metrics.regular.widthOfTextAtSize(LEYENDA_NO_FISCAL, TYPE.fine)
  const hastaLaLeyenda = PAGE_WIDTH_A4 / 2 - anchoLeyenda / 2 - LETTER_BOX_GAP - x
  return Math.min(hastaLaCaja, hastaLaLeyenda)
}
```

- [ ] **Step 4: Add the types, Cabecera and BandaCliente**

```tsx
export type EmisorData = {
  nombreEmpresa?: string | null
  telefonoEmpresa?: string | null
  direccionEmpresa?: string | null
  domicilioFiscalEmpresa?: string | null
  cuitEmpresa?: string | null
  condicionIvaEmpresa?: string | null
  ingresosBrutosEmpresa?: string | null
  inicioActividadesEmpresa?: string | null
  logoUrl?: string | null
}

export type ClienteData = {
  nombre?: string | null
  dni?: string | null
  telefono?: string | null
  email?: string | null
  direccion?: string | null
}

/** What every A4 document's data type extends. */
export type DocumentoBase = EmisorData & {
  cliente: ClienteData
  moneda?: string | null
  zonaHoraria?: string | null
  sucursalNombre?: string | null
  atendidoPor?: string | null
}

export function Cabecera({
  emisor,
  metrics,
  logo = null,
  titulo,
  numero,
  lineasDerecha = [],
  letterBox,
}: {
  emisor: EmisorData
  metrics: HelveticaMetrics
  logo?: PdfLogo | null
  titulo: string
  numero?: string
  lineasDerecha?: string[]
  /** Present renders the straddling box with this letter plus the centered legend. */
  letterBox?: string
}) {
  const presupuesto = presupuestoZonaIzquierda({ logo: Boolean(logo), letterBox: Boolean(letterBox), metrics })
  const clamp = (texto: string, bold = false) =>
    truncateToWidth(bold ? metrics.bold : metrics.regular, texto, bold ? TYPE.body : TYPE.small, presupuesto)

  const nombre = safe(emisor.nombreEmpresa) || "Servicio Tecnico"
  const telefono = safe(emisor.telefonoEmpresa)
  const direccion = safe(emisor.direccionEmpresa)
  const domicilio = safe(emisor.domicilioFiscalEmpresa)
  const cuit = safe(emisor.cuitEmpresa)
  const condicionIva = safe(emisor.condicionIvaEmpresa)
  const ingresosBrutos = safe(emisor.ingresosBrutosEmpresa)
  const inicioActividades = safe(emisor.inicioActividadesEmpresa)

  return (
    <View style={estilosShell.frame}>
      {/* The letter box straddles the frame's top border — half above, half
          below. It is absolutely positioned against the FRAME itself, not the
          padded inner wrapper, so the offset is relative to the border and
          stays aligned by flex flow. */}
      {letterBox ? (
        <>
          <View style={estilosShell.letterBoxWrap}>
            <View style={estilosShell.letterBox}>
              <Text style={estilosShell.letterBoxText}>{letterBox}</Text>
            </View>
          </View>
          <View style={estilosShell.legendWrap}>
            <Text style={estilosShell.legendText}>{LEYENDA_NO_FISCAL}</Text>
          </View>
        </>
      ) : null}

      <View style={estilosShell.frameInner}>
        <View style={estilosShell.headerRow}>
          <View style={estilosShell.leftZone}>
            {logo ? <Image style={estilosShell.leftZoneLogo} src={{ data: logo.data, format: logo.format }} /> : null}
            <View style={estilosShell.leftZoneText}>
              <Text style={estilosShell.companyName}>{clamp(nombre, true)}</Text>
              {telefono ? <Text style={estilosShell.smallLabel}>{clamp(`Tel: ${telefono}`)}</Text> : null}
              {direccion ? <Text style={estilosShell.smallLabel}>{clamp(direccion)}</Text> : null}
              {domicilio && domicilio !== direccion ? (
                <Text style={estilosShell.smallLabel}>{clamp(domicilio)}</Text>
              ) : null}
            </View>
          </View>

          {/* Reserves room under the letter box and legend so the right zone
              never slides into them. Only needed when they are drawn. */}
          {letterBox ? <View style={estilosShell.centerGutter} /> : null}

          <View style={estilosShell.rightZone}>
            <Text style={estilosShell.docTitle}>{titulo}</Text>
            {numero ? <Text style={estilosShell.docNumber}>{numero}</Text> : null}
            {lineasDerecha.map((linea, i) => (
              <Text key={i} style={estilosShell.smallLabelRight}>
                {linea}
              </Text>
            ))}
            {cuit ? <Text style={estilosShell.smallLabelRight}>CUIT: {cuit}</Text> : null}
            {ingresosBrutos ? <Text style={estilosShell.smallLabelRight}>Ingresos brutos: {ingresosBrutos}</Text> : null}
            {inicioActividades ? (
              <Text style={estilosShell.smallLabelRight}>Inicio actividades: {inicioActividades}</Text>
            ) : null}
            {condicionIva ? <Text style={estilosShell.smallLabelRight}>{condicionIva.toUpperCase()}</Text> : null}
          </View>
        </View>

        <View style={[estilosShell.hr, { marginTop: 10 }]} />
      </View>
    </View>
  )
}

export function BandaCliente({
  label,
  cliente,
  derecha,
}: {
  label: string
  cliente: ClienteData
  derecha?: React.ReactNode
}) {
  const nombre = safe(cliente?.nombre) || "Consumidor Final"
  const dni = safe(cliente?.dni)
  const telefono = safe(cliente?.telefono)
  const email = safe(cliente?.email)
  const direccion = safe(cliente?.direccion)

  return (
    <View style={estilosShell.clienteBand}>
      <View style={estilosShell.clienteLeft}>
        <Text style={estilosShell.sectionLabel}>{label}</Text>
        <Text style={estilosShell.clienteNombre}>{nombre}</Text>
        {dni ? <Text style={estilosShell.smallLabel}>DNI/CUIT: {dni}</Text> : null}
        {telefono ? <Text style={estilosShell.smallLabel}>Tel: {telefono}</Text> : null}
        {email ? <Text style={estilosShell.smallLabel}>{email}</Text> : null}
        {direccion ? <Text style={estilosShell.smallLabel}>{direccion}</Text> : null}
      </View>
      {derecha ? <View style={estilosShell.clienteRight}>{derecha}</View> : null}
    </View>
  )
}
```

Style entries to add to `estilosShell`:

```tsx
  frame: { borderWidth: RULE_WIDTH, borderColor: MONO.ink, position: "relative" },
  frameInner: { padding: 10 },
  headerRow: { flexDirection: "row", justifyContent: "space-between" },
  leftZone: { flex: 1, paddingRight: HEADER_GAP, flexDirection: "row", alignItems: "flex-start" },
  leftZoneLogo: { width: LOGO_BOX_WIDTH, height: LOGO_BOX_HEIGHT, marginRight: LOGO_GAP, objectFit: "contain" },
  leftZoneText: { flexDirection: "column" },
  centerGutter: { width: 180 },
  rightZone: { width: RIGHT_ZONE_WIDTH, alignItems: "flex-end" },
  companyName: { fontFamily: "Helvetica-Bold", fontSize: TYPE.body },
  smallLabel: { fontSize: TYPE.small, color: MONO.label, marginTop: 2 },
  smallLabelRight: { fontSize: TYPE.small, color: MONO.label, marginTop: 2, textAlign: "right" },
  docTitle: { fontFamily: "Helvetica-Bold", fontSize: TYPE.docTitle },
  docNumber: { fontFamily: "Helvetica-Bold", fontSize: TYPE.docNumber, marginTop: 2 },
  letterBoxWrap: { position: "absolute", top: -15, left: 0, right: 0, alignItems: "center" },
  letterBox: {
    width: LETTER_BOX_WIDTH,
    height: 30,
    borderWidth: RULE_WIDTH,
    borderColor: MONO.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  letterBoxText: { fontFamily: "Helvetica-Bold", fontSize: 20 },
  legendWrap: { position: "absolute", top: 21, left: 0, right: 0, alignItems: "center" },
  legendText: { fontSize: TYPE.fine, color: MONO.label },
  clienteBand: { flexDirection: "row", justifyContent: "space-between", paddingTop: 6 },
  clienteLeft: { flex: 1, paddingRight: 8 },
  clienteRight: { alignItems: "flex-end" },
  clienteNombre: { fontFamily: "Helvetica-Bold", fontSize: TYPE.body, marginTop: 3 },
```

The import line at the top of the shell grows to:

```tsx
import { View, Text, Image, StyleSheet } from "@react-pdf/renderer"
import {
  MONO,
  TYPE,
  RULE_WIDTH,
  PAGE_WIDTH_A4,
  safe,
  truncateToWidth,
  type PdfLogo,
  type HelveticaMetrics,
} from "./pdf-react-shared"
```

Both documents keep their current nesting: `<Cabecera>` renders the frame, and `<BandaCliente>` goes inside the document's own body right after it. Slice 1 changes no layout.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/pdf-react-shell.test.tsx`
Expected: PASS, 8 tests

- [ ] **Step 6: Adopt in cuenta corriente**

Delete `CabeceraCC` and the header/cliente style entries from `lib/cuenta-corriente-react-pdf.tsx`. Both documents call `<Cabecera>` with no `letterBox`, and `<BandaCliente>` with `label="Recibimos de"` (recibo) and `label="Cliente"` (resumen).

- [ ] **Step 7: Adopt in the remito**

Replace the remito's inline header with `<Cabecera … letterBox="X" />` and its cliente band with `<BandaCliente label="Cliente" … derecha={…} />`. Delete the now-unused constants and style entries.

- [ ] **Step 8: Run the affected suites**

Run: `npx vitest run __tests__/lib/pdf-react-shell.test.tsx __tests__/lib/cuenta-corriente-react-pdf.test.ts __tests__/lib/cuenta-corriente-resumen-pdf.test.ts __tests__/lib/remito-react-pdf.test.ts`
Expected: PASS, 60 tests. `remito-react-pdf.test.ts` asserts header positions with `extractReactPdfTextPositions` — if those fail, the header moved and that is a real regression, not a test to relax.

- [ ] **Step 9: Visual check**

```bash
PDF_SAMPLES=1 PDF_SAMPLES_TAG=shell npx vitest run __tests__/pdf-samples.test.ts
```

Open `.tmp-preview/pdf-samples/shell-remito.pdf` and compare against the production remito. The header must be pixel-identical: this task moved code, it did not redesign anything.

- [ ] **Step 10: Commit**

```bash
git add lib/pdf-react-shell.tsx __tests__/lib/pdf-react-shell.test.tsx lib/cuenta-corriente-react-pdf.tsx lib/remito-react-pdf.tsx
git commit -m "refactor(pdf): mover cabecera y banda de cliente al shell compartido"
```

---

## Task 6: Shell — Firmas

Six wordings of the same signature block collapse into one component. Only the two react-pdf documents that have one adopt it now; the six in `lib/pdf.ts` follow in slices 2-7.

**Files:**
- Modify: `lib/pdf-react-shell.tsx`
- Modify: `__tests__/lib/pdf-react-shell.test.tsx`
- Modify: `lib/cuenta-corriente-react-pdf.tsx`
- Modify: `lib/remito-react-pdf.tsx`

**Interfaces:**
- Produces: `<Firmas titulo={string} campos={string[]} />` — one signature line per entry in `campos`.

- [ ] **Step 1: Write the failing test**

```tsx
// append to __tests__/lib/pdf-react-shell.test.tsx
import { Firmas } from "@/lib/pdf-react-shell"

describe("Firmas", () => {
  it("draws one caption per field", async () => {
    const text = await extractReactPdfText(
      await render(<Firmas titulo="Conformidad" campos={["Firma", "Aclaración"]} />)
    )
    expect(text).toContain("CONFORMIDAD")
    expect(text).toContain("Firma")
    expect(text).toContain("Aclaración")
  })

  it("supports the four-field entrega variant", async () => {
    const text = await extractReactPdfText(
      await render(
        <Firmas titulo="Firmas de conformidad" campos={["Cliente (quien recibe)", "Encargado (quien entrega)"]} />
      )
    )
    expect(text).toContain("Cliente (quien recibe)")
    expect(text).toContain("Encargado (quien entrega)")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/pdf-react-shell.test.tsx`
Expected: FAIL — `Firmas is not exported`

- [ ] **Step 3: Add Firmas**

```tsx
export function Firmas({ titulo, campos }: { titulo: string; campos: string[] }) {
  return (
    <View style={estilosShell.firmasBlock} wrap={false}>
      <Text style={estilosShell.sectionLabel}>{titulo}</Text>
      <View style={[estilosShell.hr, { marginTop: 4 }]} />
      <View style={estilosShell.firmasRow}>
        {campos.map((campo) => (
          <View key={campo} style={estilosShell.firmaCol}>
            <View style={estilosShell.firmaLinea} />
            <Text style={estilosShell.firmaCaption}>{campo}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}
```

with these style entries added to `estilosShell`:

```tsx
  firmasBlock: { marginTop: 18 },
  firmasRow: { flexDirection: "row", marginTop: 22 },
  firmaCol: { flex: 1, marginRight: 20 },
  firmaLinea: { borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.ink },
  firmaCaption: { fontSize: TYPE.fine, color: MONO.label, marginTop: 4 },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/pdf-react-shell.test.tsx`
Expected: PASS, 10 tests

- [ ] **Step 5: Adopt in both documents**

Recibo: `<Firmas titulo="Conformidad" campos={["Firma", "Aclaración"]} />`. Remito (orden-sourced branch only): `<Firmas titulo="Recibí conforme" campos={["Firma", "Aclaración"]} />`. Delete the local `recibiBlock` / `sigRow` / `sigCol` / `sigLine` / `sigCaption` entries from both files.

- [ ] **Step 6: Run the affected suites**

Run: `npx vitest run __tests__/lib/pdf-react-shell.test.tsx __tests__/lib/cuenta-corriente-react-pdf.test.ts __tests__/lib/cuenta-corriente-resumen-pdf.test.ts __tests__/lib/remito-react-pdf.test.ts`
Expected: PASS, 62 tests

- [ ] **Step 7: Commit**

```bash
git add lib/pdf-react-shell.tsx __tests__/lib/pdf-react-shell.test.tsx lib/cuenta-corriente-react-pdf.tsx lib/remito-react-pdf.tsx
git commit -m "refactor(pdf): unificar el bloque de firmas en el shell"
```

---

## Task 7: Shell — Tabla

The last and most valuable piece: a table whose header repeats across page breaks. Three tables adopt it — the remito's items and pagos tables, and the resumen's movements table.

**Files:**
- Modify: `lib/pdf-react-shell.tsx`
- Modify: `__tests__/lib/pdf-react-shell.test.tsx`
- Modify: `lib/cuenta-corriente-react-pdf.tsx`
- Modify: `lib/remito-react-pdf.tsx`

**Interfaces:**
- Produces:
  - `type ColumnaTabla = { key: string; titulo: string; ancho?: number; flex?: boolean; alinear?: "left" | "right"; bold?: boolean }`
  - `<Tabla columnas={ColumnaTabla[]} filas={Array<Record<string, React.ReactNode>>} headerFijo={boolean} />`

`headerFijo` exists because `fixed` repeats a node across every page that its own nearest splitting parent spans — verified at source in `@react-pdf/layout`: `splitNodes` pushes a fixed child into both the current and next page's copy of whatever node list it is handed, and only a *direct child of `Page`* is handed the Page's own children, which is the one case where that reads as "document-global". Nested further down the tree (as `<Tabla>`'s header row is), a fixed node repeats only across the pages its own parent — the table's frame — spans, then stops. Both the resumen's and the remito's tables want that. Default `false`.

- [ ] **Step 1: Write the failing test**

```tsx
// append to __tests__/lib/pdf-react-shell.test.tsx
import { Tabla, type ColumnaTabla } from "@/lib/pdf-react-shell"
import { extractReactPdfTextPositions } from "./pdf-text-helper-react"

const COLS: ColumnaTabla[] = [
  { key: "fecha", titulo: "FECHA", ancho: 58 },
  { key: "concepto", titulo: "CONCEPTO", flex: true },
  { key: "monto", titulo: "MONTO", ancho: 74, alinear: "right", bold: true },
]

describe("Tabla", () => {
  it("renders the header and every row", async () => {
    const text = await extractReactPdfText(
      await render(
        <Tabla
          columnas={COLS}
          filas={[{ fecha: "01/08/2026", concepto: "Depósito", monto: "$ 1.000,00" }]}
        />
      )
    )
    expect(text).toContain("FECHA")
    expect(text).toContain("CONCEPTO")
    expect(text).toContain("Depósito")
    expect(text).toContain("$ 1.000,00")
  })

  it("repeats the header on later pages when headerFijo is set", async () => {
    const filas = Array.from({ length: 60 }, (_, i) => ({
      fecha: "01/08/2026",
      concepto: `Movimiento ${i}`,
      monto: "$ 100,00",
    }))
    const buffer = await render(<Tabla columnas={COLS} filas={filas} headerFijo />)
    const items = await extractReactPdfTextPositions(buffer)
    const paginas = new Set(items.filter((i) => i.text === "CONCEPTO").map((i) => i.page))
    expect(paginas.has(1)).toBe(true)
    expect(paginas.has(2)).toBe(true)
  })

  it("does not repeat the header when headerFijo is not set", async () => {
    const filas = Array.from({ length: 60 }, (_, i) => ({
      fecha: "01/08/2026",
      concepto: `Movimiento ${i}`,
      monto: "$ 100,00",
    }))
    const buffer = await render(<Tabla columnas={COLS} filas={filas} />)
    const items = await extractReactPdfTextPositions(buffer)
    const paginas = new Set(items.filter((i) => i.text === "CONCEPTO").map((i) => i.page))
    expect(paginas).toEqual(new Set([1]))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/pdf-react-shell.test.tsx`
Expected: FAIL — `Tabla is not exported`

- [ ] **Step 3: Add Tabla**

```tsx
export type ColumnaTabla = {
  key: string
  titulo: string
  ancho?: number
  flex?: boolean
  alinear?: "left" | "right"
  bold?: boolean
}

export function Tabla({
  columnas,
  filas,
  headerFijo = false,
}: {
  columnas: ColumnaTabla[]
  filas: Array<Record<string, React.ReactNode>>
  headerFijo?: boolean
}) {
  const celda = (col: ColumnaTabla, ultima: boolean) => ({
    ...(col.flex ? { flex: 1 } : { width: col.ancho }),
    paddingLeft: col.alinear === "right" ? 0 : 6,
    paddingRight: col.alinear === "right" ? 6 : 4,
    ...(ultima ? {} : { borderRightWidth: RULE_WIDTH, borderRightColor: MONO.ink }),
    fontSize: TYPE.small,
    textAlign: col.alinear ?? ("left" as const),
    ...(col.bold ? { fontFamily: "Helvetica-Bold" } : {}),
  })

  return (
    <View style={estilosShell.tablaFrame}>
      {/* fixed={headerFijo} would be wrong here: @react-pdf/layout's
          shouldBreak tests `'fixed' in props`, not its value, so
          fixed={false} is not equivalent to omitting the prop. The flag must
          be spread in conditionally. */}
      <View style={estilosShell.tablaHeader} {...(headerFijo ? { fixed: true } : {})}>
        {columnas.map((col, i) => (
          <Text key={col.key} style={[celda(col, i === columnas.length - 1), estilosShell.tablaHeaderCell]}>
            {col.titulo}
          </Text>
        ))}
      </View>
      {filas.map((fila, f) => (
        <View key={f} style={estilosShell.tablaFila} wrap={false}>
          {columnas.map((col, i) => (
            <View key={col.key} style={celda(col, i === columnas.length - 1)}>
              {typeof fila[col.key] === "string" ? <Text>{fila[col.key]}</Text> : fila[col.key]}
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}
```

with these style entries:

```tsx
  tablaFrame: { borderWidth: RULE_WIDTH, borderColor: MONO.ink, marginTop: 8 },
  tablaHeader: {
    flexDirection: "row",
    borderBottomWidth: RULE_WIDTH,
    borderBottomColor: MONO.ink,
    backgroundColor: MONO.totalBg,
    paddingVertical: 5,
  },
  tablaHeaderCell: { fontFamily: "Helvetica-Bold", color: MONO.label },
  tablaFila: { flexDirection: "row", borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.rule, paddingVertical: 4 },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/pdf-react-shell.test.tsx`
Expected: PASS, 13 tests

- [ ] **Step 5: Adopt in the resumen**

Replace the hand-built table in `ResumenCCDocument` with `<Tabla headerFijo columnas={…} filas={…} />`, keeping the same column widths (58 / flex / 86 / 68 / 68 / 74) and the same totals row below it. Delete the `colFecha` … `colSaldo` style entries.

- [ ] **Step 6: Adopt in the remito**

Replace the items table and the pagos table with `<Tabla>`, both **with** `headerFijo` — `fixed` only repeats a node across the pages its own parent (here, the table's frame) spans, not document-globally, so the remito's sections after each table are never at risk. Its pagos rows carry a note line under the reference, which is why `filas` accepts `React.ReactNode` and not just strings.

- [ ] **Step 7: Run the affected suites**

Run: `npx vitest run __tests__/lib/pdf-react-shell.test.tsx __tests__/lib/cuenta-corriente-react-pdf.test.ts __tests__/lib/cuenta-corriente-resumen-pdf.test.ts __tests__/lib/remito-react-pdf.test.ts`
Expected: PASS, 65 tests. `factura-pdf-venta.test.ts:780` has a test named "HISTORIAL DE PAGOS paginates on its own" — it exercises the pdf-lib engine, not this one, and is unaffected either way; it is cited here only as a reminder that the remito's pagos table has paginated on its own since before this migration and must keep doing so under react-pdf.

- [ ] **Step 8: Full suite, types, lint**

```bash
npx vitest run
npx tsc --noEmit
npx eslint lib/pdf-react-shell.tsx lib/cuenta-corriente-react-pdf.tsx lib/remito-react-pdf.tsx
```

Expected: all green. Do not run `npm run lint` — it walks the `.worktrees/` directories and does not terminate.

- [ ] **Step 9: Visual check against production**

```bash
PDF_SAMPLES=1 PDF_SAMPLES_TAG=shell npx vitest run __tests__/pdf-samples.test.ts
```

Compare `shell-remito.pdf` against a remito pulled from production. Slice 1 moved code; any visible difference is a bug, not a redesign.

- [ ] **Step 10: Commit**

```bash
git add lib/pdf-react-shell.tsx __tests__/lib/pdf-react-shell.test.tsx lib/cuenta-corriente-react-pdf.tsx lib/remito-react-pdf.tsx
git commit -m "refactor(pdf): tabla compartida con header repetible en el shell"
```

- [ ] **Step 11: Open the documents in production after merge**

The smoke check from Tasks 1-2 covers bundle failures. This covers what it cannot: a real logo URL, real fiscal data, real page counts. Open a remito, a recibo and a resumen on the tenant subdomain and confirm they still look right.

---

## Notes for whoever executes this

**The branch moves between sessions.** Run `git branch --show-current` and `git fetch` before committing. There has been uncommitted work from other tasks sitting in this working tree; commit only the files each task lists.

**The full suite takes about 2.5 minutes** and passes at 2607 tests before this plan starts. That number is the baseline — each task adds to it and none should subtract.
