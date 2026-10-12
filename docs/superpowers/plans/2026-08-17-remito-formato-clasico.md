# Remito Classic Form Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the remito PDF (`generateFacturaPDF`) as a classic Argentine framed form (letter box X, header zones, CLIENTE/CONDICIONES bands, ruled tables) while keeping all money content, and add two emitter fiscal fields (`ingresos_brutos`, `inicio_actividades`) end to end (migration → settings card → PDF route → PDF header).

**Architecture:** All layout work happens inside `generateFacturaPDF` (lib/pdf.ts:3454-4012) using the existing monochrome helpers from `lib/pdf-style.ts` (MONO, TYPE, RULE_WIDTH, drawRule, drawSectionLabel, drawOutlinedBadge). The classic look is expressed with frames and rules only — no new colors. Data plumbing follows the migration-295 pattern exactly: guarded `ADD COLUMN IF NOT EXISTS` migration, tiered pre-migration degradation via `isMissingColumnError` (42703 on select, PGRST204 on write), threading through `app/api/facturacion/[id]/pdf/route.ts`.

**Tech Stack:** Next.js (App Router API routes), pdf-lib (Type0/Identity-H subsetted fonts — text assertions must use `__tests__/lib/pdf-text-helper.ts`), Supabase/PostgREST, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-13-remito-formato-clasico-design.md`

## Global Constraints

- Strict TDD: every behavior change lands test-first (`RED → GREEN → commit`).
- Migration number is **297** (296 was taken by facturación electrónica in PR #298). Number is still tentative until merge — repo convention: number assigned at merge time.
- Migrations are applied MANUALLY via `scripts/db-run.mjs` (dry-run by default) — never applied by this plan. Code must degrade gracefully pre-migration.
- Letter is **X** with legend `Documento no válido como comprobante fiscal`. The strings `R` (as document letter), `Cód. 91`, or `91` as a doc-type code must NEVER be rendered.
- Money content is preserved: subtotal/IVA/total rows, SALDO PENDIENTE bar, HISTORIAL DE PAGOS with running balance, PAGADO badge, Recibí conforme (orden only).
- Every new header line is conditional on its field — an org without fiscal data renders the same info as today, inside the new frame.
- Out of scope: TRANSPORTE band, CÓDIGO/ENVASE columns, client IVA condition, other PDF generators (recepción, expediente, garantía, nota de crédito, térmico).
- NEVER run two vitest processes concurrently in this repo (they kill each other). Run test commands one at a time.
- All code, comments, UI copy in the language of the surrounding file (UI copy is Spanish in this project; code/comments English).
- Commits: conventional commits, no AI attribution, no Co-Authored-By.
- Working directory: the git worktree `C:\Users\LUIS\Desktop\stapp\.claude\worktrees\remito-formato-clasico`, branch `worktree-remito-formato-clasico` (rebased on origin/main at 1650af23).

## Key existing code map (read before your task)

- `lib/pdf.ts:3385-3436` — `FacturaPDFData` interface. `generateFacturaPDF` spans 3454-4012.
- `lib/pdf-style.ts` — MONO/TYPE/RULE_WIDTH (5-24), `drawRule(page, x1, x2, y, opts?)` (horizontal hairline only), `drawSectionLabel(page, fontBold, text, x, y)`, `drawOutlinedBadge`. No fill on outlined shapes: `page.drawRectangle({ borderColor, borderWidth })` with no `color`.
- Page geometry: `[595, 842]` A4, `margin = 40`, `contentWidth = 515`, `floorY = margin + 80` (pagination floor), footer loop over `pages[]` at 3992-4008.
- `startContinuationPage(drawTableHeader?)` at lib/pdf.ts:3714-3727 — adds page, draws `REMITO {nro} — continuación` title + rule, resets `y`, optionally redraws the table header row.
- PDF route: `app/api/facturacion/[id]/pdf/route.ts` — `ORG_COLS` (line 15), `ORG_COLS_FISCAL` (line 16), fetch helpers `fetchFacturaOrden` (18-40) / `fetchFacturaVenta` (42-63) take `withFiscal: boolean`; call sites try fiscal then retry base on `isMissingColumnError` (130-134, 196-200); org fields threaded into `pdfData` at 187-192 (orden) and 233-238 (venta).
- Settings: `components/configuracion/configuracion-form.tsx` (card "Datos fiscales y de cobro" at 838-923, save payload ~274, PUT to `/api/configuracion`). Route `app/api/configuracion/route.ts` GET/PUT with tiered column degradation: full (296 toggle + 295 fiscal) → drop 296 → drop 295.
- `lib/db-errors.ts:21-32` — `isMissingColumnError(error: unknown): boolean` (PGRST204 | 42703 | "does not exist" | "schema cache").
- Tests: `__tests__/lib/factura-pdf-venta.test.ts` (`// @vitest-environment node` on line 1; uses `extractPdfText` / `extractPdfTextPositions` from `__tests__/lib/pdf-text-helper.ts`). API-level degradation tests: `__tests__/api/facturacion-pdf-fiscal.test.ts`. Sample PDFs for visual inspection: `__tests__/pdf-samples.test.ts`.
- Run one file: `npx vitest run __tests__/lib/factura-pdf-venta.test.ts`. Full run: `npm run test:run`.

---

### Task 1: Migration 297 + rollback

**Files:**
- Create: `supabase/migrations/297_ingresos_brutos_inicio_actividades.sql`
- Create: `supabase/migrations/rollback/297_rollback.sql`
- Read first: `supabase/migrations/295_datos_fiscales_cobro_organizations.sql` and `supabase/migrations/rollback/295_rollback.sql` (the template — copy its guard style and comment format)

**Interfaces:**
- Produces: `organizations.ingresos_brutos TEXT NULL`, `organizations.inicio_actividades TEXT NULL` — column names used verbatim by Tasks 2 and 3.

- [ ] **Step 1: Write the migration**

```sql
-- 297: Ingresos brutos + inicio de actividades del emisor (remito formato clásico)
-- Ambos TEXT nullable: se muestran en el encabezado del remito solo si están cargados.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ingresos_brutos TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS inicio_actividades TEXT;

COMMENT ON COLUMN organizations.ingresos_brutos IS 'Número de inscripción en Ingresos Brutos del emisor (texto libre, ej: 902-123456-7). Encabezado del remito.';
COMMENT ON COLUMN organizations.inicio_actividades IS 'Fecha de inicio de actividades del emisor (texto libre, ej: 01/2020). Encabezado del remito.';
```

Match 295's header-comment style after reading it; keep the guarded `IF NOT EXISTS` form.

- [ ] **Step 2: Write the rollback**

```sql
-- Rollback 297: quitar campos de encabezado del remito clásico

ALTER TABLE organizations DROP COLUMN IF EXISTS ingresos_brutos;
ALTER TABLE organizations DROP COLUMN IF EXISTS inicio_actividades;
```

- [ ] **Step 3: Sanity-check SQL syntax** — no runner available here; verify by eye against 295 (guard style, semicolons, comment quoting). Do NOT apply the migration.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/297_ingresos_brutos_inicio_actividades.sql supabase/migrations/rollback/297_rollback.sql
git commit -m "feat(db): add ingresos_brutos and inicio_actividades to organizations"
```

---

### Task 2: Thread the new fields into FacturaPDFData via the PDF route

**Files:**
- Modify: `lib/pdf.ts:3426-3432` area (FacturaPDFData interface only — no layout work)
- Modify: `app/api/facturacion/[id]/pdf/route.ts` (lines 15-16, 18-63, 130-134, 187-192, 196-200, 233-238)
- Test: `__tests__/api/facturacion-pdf-fiscal.test.ts` (extend)

**Interfaces:**
- Consumes: columns `ingresos_brutos`, `inicio_actividades` (Task 1).
- Produces: `FacturaPDFData.ingresosBrutosEmpresa?: string | null` and `FacturaPDFData.inicioActividadesEmpresa?: string | null` — exact names Task 4 draws from. Route constant `ORG_COLS_FISCAL_V2` and fetch-helper signature `fetchFacturaOrden(supabase, id, orgId, fiscalTier: 2 | 1 | 0)` (same for `fetchFacturaVenta`).

- [ ] **Step 1: Read the existing degradation tests** — read `__tests__/api/facturacion-pdf-fiscal.test.ts` end to end to learn its supabase mock harness. New tests reuse that harness verbatim.

- [ ] **Step 2: Write failing tests** in that file, following its existing mock pattern:
  - **Happy path**: org row includes `ingresos_brutos: "902-123456-7"`, `inicio_actividades: "01/2020"` → the `generateFacturaPDF` call (or pdfData assertion, matching how existing tests assert) receives `ingresosBrutosEmpresa: "902-123456-7"` and `inicioActividadesEmpresa: "01/2020"`.
  - **Pre-297 degradation**: first org select (with `ingresos_brutos`) fails with `{ code: "42703", message: 'column organizations.ingresos_brutos does not exist' }` → route retries with the 295-only column list, response is still 200, and the 295 fiscal fields (`cuitEmpresa` etc.) are STILL present (must not fall all the way back to base cols).
  - **Pre-295 degradation** (existing behavior still works): 42703 on both fiscal tiers → falls back to `ORG_COLS`, 200, no fiscal fields.

- [ ] **Step 3: Run tests to verify the new ones fail**

Run: `npx vitest run __tests__/api/facturacion-pdf-fiscal.test.ts`
Expected: new tests FAIL (unknown column / missing pdfData fields); pre-existing tests PASS.

- [ ] **Step 4: Implement**
  - `lib/pdf.ts` — add to `FacturaPDFData` after `domicilioFiscalEmpresa`:
    ```ts
    ingresosBrutosEmpresa?: string | null
    inicioActividadesEmpresa?: string | null
    ```
  - Route line 16-17:
    ```ts
    const ORG_COLS_FISCAL = `${ORG_COLS}, cuit, condicion_iva, domicilio_fiscal, cbu_alias, medios_pago_texto, plazo_pago_dias`
    const ORG_COLS_FISCAL_V2 = `${ORG_COLS_FISCAL}, ingresos_brutos, inicio_actividades`
    ```
  - Change both fetch helpers' `withFiscal: boolean` param to `fiscalTier: 2 | 1 | 0` selecting `ORG_COLS_FISCAL_V2` / `ORG_COLS_FISCAL` / `ORG_COLS`.
  - Call sites (130-134 and 196-200): chain `try tier 2 → on isMissingColumnError try tier 1 → on isMissingColumnError try tier 0`, preserving the existing non-column-error rethrow behavior.
  - Thread in both pdfData builders (orden and venta branches):
    ```ts
    ingresosBrutosEmpresa: org?.ingresos_brutos,
    inicioActividadesEmpresa: org?.inicio_actividades,
    ```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run __tests__/api/facturacion-pdf-fiscal.test.ts`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/pdf.ts app/api/facturacion/[id]/pdf/route.ts __tests__/api/facturacion-pdf-fiscal.test.ts
git commit -m "feat(pdf): thread ingresos brutos and inicio actividades into remito data"
```

---

### Task 3: Settings card inputs + configuración route degradation tier

**Files:**
- Modify: `app/api/configuracion/route.ts` (GET ~56-109, PUT ~393-547)
- Modify: `components/configuracion/configuracion-form.tsx` (state ~74, populate ~127-157, payload ~274, card markup 838-923)
- Test: extend the existing configuración route tests — `Glob __tests__/api/configuracion*` first; if a suite exists, extend it; if none exists, add route-level tests ONLY for the new tier following the mock harness of `__tests__/api/facturacion-pdf-fiscal.test.ts`.

**Interfaces:**
- Consumes: columns from Task 1.
- Produces: GET response JSON fields `ingresosBrutos`, `inicioActividades` (camelCase, matching the existing `cuit`/`condicionIva` naming in the route); PUT accepts the same two keys.

- [ ] **Step 1: Read the route's tier structure** — read `app/api/configuracion/route.ts` GET and PUT fully. Current tiers: full (296 toggle + 295 fiscal) → drop 296 → drop 295. The new top tier adds the 297 columns; degradation order becomes: **full(297+296+295) → drop 297 → drop 296 → drop 295**.

- [ ] **Step 2: Write failing tests** (per the Test note above):
  - GET with all columns present returns `ingresosBrutos` / `inicioActividades` values.
  - GET where the select including `ingresos_brutos` fails with 42703 → retry without the 297 pair succeeds → 200 with `ingresosBrutos: null` (or absent, matching how the route signals missing 295 fields today — mirror that convention) and 295 fields intact.
  - PUT with `ingresosBrutos` set, first update failing with `{ code: "PGRST204" }` → retried without the 297 pair → 200, other fields saved.

- [ ] **Step 3: Run to verify RED** — `npx vitest run <the test file>`. Expected: new tests FAIL.

- [ ] **Step 4: Implement route** — add `ingresos_brutos, inicio_actividades` to the top-tier column list in GET and to the PUT payload; insert the new "drop 297" retry step above the existing "drop 296" step in both handlers, reusing `isMissingColumnError`. Follow the existing comment style documenting 42703-select vs PGRST204-write.

- [ ] **Step 5: Implement form** — in `configuracion-form.tsx`:
  - State: `const [ingresosBrutos, setIngresosBrutos] = useState("")` and `const [inicioActividades, setInicioActividades] = useState("")` next to the `cuit` state.
  - Populate from GET response alongside `cuit` (~127-157).
  - Add both to the PUT payload (~274).
  - Card markup: two new text inputs in "Datos fiscales y de cobro", copying the exact JSX structure of the CUIT input (label + Input + helper text if the card uses one): labels `Ingresos brutos` and `Inicio de actividades`, placeholders `902-123456-7` and `01/2020`.

- [ ] **Step 6: Run to verify GREEN** — same command. Expected: ALL PASS. Also run `npx vitest run __tests__/api/facturacion-pdf-fiscal.test.ts` (route file shared? no — but cheap regression guard).

- [ ] **Step 7: Commit**

```bash
git add app/api/configuracion/route.ts components/configuracion/configuracion-form.tsx __tests__/
git commit -m "feat(configuracion): capture ingresos brutos and inicio de actividades"
```

---

### Task 4: PDF header — zones, letter box X, outer frame

**Files:**
- Modify: `lib/pdf.ts` — `generateFacturaPDF` header region (3510-3631) and the CONDICIONES / CLIENTE regions ONLY as far as recording frame geometry (full bands are Task 5)
- Test: `__tests__/lib/factura-pdf-venta.test.ts` (extend)

**Interfaces:**
- Consumes: `ingresosBrutosEmpresa` / `inicioActividadesEmpresa` (Task 2 names).
- Produces: local helper `drawVLine(pg, x, y1, y2)` (vertical hairline: `pg.drawLine({ start: {x, y: y1}, end: {x, y: y2}, thickness: RULE_WIDTH, color: MONO.ink })`) and local consts `frameTop` (= `height - margin`), `frameLeft = margin`, `frameRight = width - margin`, `innerPad = 10` — reused by Tasks 5-6. The outer frame rectangle itself is drawn at the END of the CONDICIONES band in Task 5 (geometry recorded here).

- [ ] **Step 1: Read the pdf text helper** — read `__tests__/lib/pdf-text-helper.ts` to confirm the exact shape returned by `extractPdfTextPositions` (adapt the field names in the snippets below to what the helper actually returns — e.g. `text`/`str`, `size`/`fontSize`).

- [ ] **Step 2: Write failing tests** in `factura-pdf-venta.test.ts`:

```ts
describe("generateFacturaPDF — classic form header", () => {
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

  it("renders the letter box: X legend present, fiscal letter R / cod 91 never rendered", async () => {
    const buffer = await generateFacturaPDF(baseData as any)
    const text = await extractPdfText(buffer)
    expect(text).toContain("Documento no válido como comprobante fiscal")
    expect(text).not.toContain("Cód. 91")
    expect(text).not.toContain("COD. 91")
    const items = await extractPdfTextPositions(buffer)
    const letterX = items.find((i) => i.text === "X" && i.size >= 18)
    expect(letterX).toBeDefined()
  })

  it("shows ingresos brutos, inicio de actividades and IVA condition in caps when set", async () => {
    const buffer = await generateFacturaPDF({
      ...baseData,
      cuitEmpresa: "23944498389",
      condicionIvaEmpresa: "Monotributo",
      ingresosBrutosEmpresa: "902-123456-7",
      inicioActividadesEmpresa: "01/2020",
    } as any)
    const text = await extractPdfText(buffer)
    expect(text).toContain("CUIT: 23944498389")
    expect(text).toContain("Ingresos brutos: 902-123456-7")
    expect(text).toContain("Inicio actividades: 01/2020")
    expect(text).toContain("MONOTRIBUTO")
  })

  it("omits the fiscal header lines when the org has no fiscal data", async () => {
    const buffer = await generateFacturaPDF(baseData as any)
    const text = await extractPdfText(buffer)
    expect(text).not.toContain("Ingresos brutos:")
    expect(text).not.toContain("Inicio actividades:")
    expect(text).not.toContain("CUIT:")
  })
})
```

- [ ] **Step 3: Run to verify RED** — `npx vitest run __tests__/lib/factura-pdf-venta.test.ts`. Expected: the three new tests FAIL (legend/X/lines absent); all pre-existing tests still PASS.

- [ ] **Step 4: Implement the header rewrite** (region 3510-3631):
  - Keep the logo block (3510-3549) but inset content: left zone starts at `frameLeft + innerPad`.
  - **Left zone** (top at `frameTop - 16`, line step 12): company name bold (`TYPE.body`), then conditional small lines: teléfono, dirección, domicilio fiscal. **CUIT and condición IVA MOVE OUT of the left zone** (they go right). Track `leftLines` count.
  - **Letter box** (center): box 34×30 centered horizontally (`x = (width - 34) / 2`), vertically straddling `frameTop` (top edge `frameTop + 15`, bottom `frameTop - 15`): `page.drawRectangle({ x, y: frameTop - 15, width: 34, height: 30, borderColor: MONO.ink, borderWidth: RULE_WIDTH })`. Bold `X` size 20 centered in the box (measure with `helveticaBold.widthOfTextAtSize("X", 20)`). Legend `Documento no válido como comprobante fiscal` centered below the box at `TYPE.fine`, color `MONO.label`, baseline `frameTop - 25`. Keep the left/right zone first lines clear of the centered legend (clamp left-zone text width to ~200pt; right zone is right-aligned so it clears naturally).
  - **Right zone** (right-aligned to `frameRight - innerPad`): `REMITO` (`TYPE.docTitle`), `Nº {numeroFactura}` (`TYPE.docNumber` — keep existing sizes from 3582-3621), `Emisión: {fecha}` / existing date lines, `Operación: {fechaOperacion}` when present — then one small (`TYPE.small`) line each, ONLY when present: `CUIT: {cuitEmpresa}`, `Ingresos brutos: {ingresosBrutosEmpresa}`, `Inicio actividades: {inicioActividadesEmpresa}`, and `IVA {condicionIvaEmpresa}`.toUpperCase() — wait: spec says the caps line is the IVA condition itself, e.g. `MONOTRIBUTO` or `IVA RESPONSABLE INSCRIPTO`; render `condicionIvaEmpresa.toUpperCase()` as its own line (no prefix added when the value already starts with "IVA"; do not invent a prefix — just uppercase the stored value). Track `rightLines`.
  - **Header bottom**: `headerBottomY = frameTop - 16 - 12 * max(leftLines, rightLines) - 8` (replaces the `emisorExtraLines` offset math at 3623-3631); draw the divider `drawRule(page, frameLeft, frameRight, headerBottomY)`. Keep `y = headerBottomY` flowing into the CLIENTE block.
  - Define `drawVLine` next to the other local helpers. Do NOT draw the outer rectangle yet (Task 5 closes the frame after CONDICIONES); just leave `frameTop/frameLeft/frameRight/innerPad` in scope.

- [ ] **Step 5: Run to verify GREEN** — same command. Expected: ALL PASS (new + pre-existing — pre-existing tests asserting CUIT lines may need their expectations moved, but content must remain present; never delete a money/content assertion).

- [ ] **Step 6: Commit**

```bash
git add lib/pdf.ts __tests__/lib/factura-pdf-venta.test.ts
git commit -m "feat(pdf): classic remito header with letter box X and fiscal lines"
```

---

### Task 5: CLIENTE band + CONDICIONES band + outer frame close

**Files:**
- Modify: `lib/pdf.ts` — CLIENTE block (3633-3653), ORDEN/VENTA reference block (3655-3666), CONDICIONES block (3875-3899 — MOVES UP to sit right after the CLIENTE band), totals kept-together math (3759-3788)
- Test: `__tests__/lib/factura-pdf-venta.test.ts` (extend)

**Interfaces:**
- Consumes: `headerBottomY`, `frameLeft/frameRight/frameTop/innerPad`, `drawVLine` (Task 4).
- Produces: the outer frame closed at `frameBottom` (bottom rule of the last band); `y` positioned below the frame for the items table (Task 6 consumes `y`).

- [ ] **Step 1: Write failing tests**. `baseData` is the fixture Task 4 added to this file — if it is still scoped inside Task 4's `describe`, hoist it to module scope first so all describes share it:

```ts
describe("generateFacturaPDF — classic form bands", () => {
  it("CLIENTE band shows CUIT/DNI and the VENTA reference on the right half", async () => {
    const buffer = await generateFacturaPDF({
      ...baseData,
      cliente: { nombre: "Juan Pérez", dni: "30123456" },
      venta: { numeroVenta: 22 },
    } as any)
    const text = await extractPdfText(buffer)
    expect(text).toContain("CUIT/DNI: 30123456")
    expect(text).toContain("VENTA: V0022")
  })

  it("CLIENTE band shows the ORDEN reference with código and dispositivo", async () => {
    const buffer = await generateFacturaPDF({
      ...baseData,
      venta: undefined,
      orden: { numeroOrden: 8, codigoOrden: "ORD-0008", dispositivo: "Notebook Lenovo" },
    } as any)
    const text = await extractPdfText(buffer)
    expect(text).toContain("ORDEN: ORD-0008 — Notebook Lenovo")
  })

  it("CONDICIONES band renders above the items table when data exists, absent when empty", async () => {
    const withCond = await generateFacturaPDF({
      ...baseData,
      items: [{ descripcion: "acc p", cantidad: 1, precioUnitario: 3000, subtotal: 3000 }],
      cbuAlias: "astecnoar",
    } as any)
    const positions = await extractPdfTextPositions(withCond)
    const cond = positions.find((i) => i.text.includes("CONDICIONES"))
    const detalle = positions.find((i) => i.text.includes("DETALLE DE ITEMS"))
    expect(cond).toBeDefined()
    expect(detalle).toBeDefined()
    expect(cond!.y).toBeGreaterThan(detalle!.y) // CONDICIONES sits above the table
    const without = await generateFacturaPDF(baseData as any)
    expect(await extractPdfText(without)).not.toContain("CONDICIONES")
  })
})
```

(Adapt the `VENTA: V0022` / `ORDEN: …` expected strings to the existing reference format found at lib/pdf.ts:3655-3666 — keep the existing number formatting, only uppercase the label and relocate it. If the current code pads `V` numbers to 4 digits, keep that.)

- [ ] **Step 2: Run to verify RED** — `npx vitest run __tests__/lib/factura-pdf-venta.test.ts`.

- [ ] **Step 3: Implement**:
  - **CLIENTE band** (replaces 3633-3666): starts at `headerBottomY`. Left half (from `frameLeft + innerPad`): `drawSectionLabel` `CLIENTE`, client name bold, then existing conditional lines (domicilio/tel/email). Right half (from `frameLeft + contentWidth / 2 + innerPad`): `CUIT/DNI: {dni}` when present, then the origin reference — `ORDEN: {codigoOrden} — {dispositivo}` (fall back to `ORDEN: #{numeroOrden} — {dispositivo}` when `codigoOrden` is null, preserving whatever fallback 3655-3666 uses today) or the venta line with uppercased label. Band closes with `drawRule(page, frameLeft, frameRight, bandBottomY)`.
  - **CONDICIONES band**: move the block currently at 3875-3899 up here, unchanged content (Vencimiento / Medios de pago / CBU-Alias, each conditional), rendered as a labeled band under CLIENTE, only when `hasCondiciones`. Its bottom rule is the frame bottom.
  - **Close the outer frame**: `frameBottom` = bottom rule y of the last band drawn (CONDICIONES if present, else CLIENTE). Draw `page.drawRectangle({ x: frameLeft, y: frameBottom, width: contentWidth, height: frameTop - frameBottom, borderColor: MONO.ink, borderWidth: RULE_WIDTH })`. Set `y = frameBottom - 24` for the items table.
  - **Fix the totals kept-together math** (3759-3788): CONDICIONES no longer lives in the totals block — remove its contribution from `totalsBlockH` (the comment documents the 177 breakdown; recompute and update the comment).

- [ ] **Step 4: Run to verify GREEN** — same command, plus `npx vitest run __tests__/pdf-samples.test.ts` (regenerates sample PDFs — read the test to find the output dir; note it in your report for visual inspection).

- [ ] **Step 5: Commit**

```bash
git add lib/pdf.ts __tests__/lib/factura-pdf-venta.test.ts
git commit -m "feat(pdf): CLIENTE and CONDICIONES bands inside classic remito frame"
```

---

### Task 6: Framed ruled tables (items + pagos) with continuation pages

**Files:**
- Modify: `lib/pdf.ts` — items table setup + rows (3668-3757), `startContinuationPage` (3714-3727), HISTORIAL DE PAGOS table (3901-3950)
- Test: `__tests__/lib/factura-pdf-venta.test.ts` (extend)

**Interfaces:**
- Consumes: `drawVLine`, `y` from Task 5.
- Produces: nothing new for later tasks — money rows, saldo bar, badge, recibí conforme, footer stay byte-identical in content.

- [ ] **Step 1: Write failing tests**:

```ts
describe("generateFacturaPDF — classic ruled tables", () => {
  it("items table header reads CANT before DESCRIPCION and money content survives", async () => {
    const buffer = await generateFacturaPDF({
      ...baseData,
      items: [{ descripcion: "acc p", cantidad: 1, precioUnitario: 3000, subtotal: 3000 }],
      pagos: [{ monto: 3000, metodoPago: "EFECTIVO", fecha: new Date("2026-08-17") }],
    } as any)
    const positions = await extractPdfTextPositions(buffer)
    const cant = positions.find((i) => i.text.includes("CANT"))
    const desc = positions.find((i) => i.text.includes("DESCRIPCIÓN"))
    expect(cant).toBeDefined()
    expect(desc).toBeDefined()
    expect(cant!.x).toBeLessThan(desc!.x)
    const text = await extractPdfText(buffer)
    expect(text).toContain("SALDO")
    expect(text).toContain("HISTORIAL DE PAGOS")
  })

  it("multipage: every page is A4 and continuation redraws title + table header", async () => {
    const manyItems = Array.from({ length: 60 }, (_, i) => ({
      descripcion: `Item ${i + 1}`,
      cantidad: 1,
      precioUnitario: 100,
      subtotal: 100,
    }))
    const buffer = await generateFacturaPDF({ ...baseData, items: manyItems, subtotal: 6000, total: 6000, montoAbonado: 0 } as any)
    const doc = await PDFDocument.load(buffer)
    expect(doc.getPageCount()).toBeGreaterThan(1)
    for (const p of doc.getPages()) {
      const { height } = p.getSize()
      expect(p.getMediaBox().y + height).toBe(842)
    }
    const text = await extractPdfText(buffer)
    expect(text).toContain("continuación")
  })
})
```

(If `factura-pdf-venta.test.ts` already asserts the multipage/mediaBox invariant, extend that test instead of duplicating it. Import `PDFDocument` from `pdf-lib` if not already imported.)

- [ ] **Step 2: Run to verify RED** — `npx vitest run __tests__/lib/factura-pdf-venta.test.ts`. Expected: CANT-before-DESCRIPCIÓN fails (current order starts with DESCRIPCIÓN).

- [ ] **Step 3: Implement**:
  - **Column reorder + boundaries** (items table): CANT | DESCRIPCIÓN | PRECIO | SUBTOTAL with x-boundaries `[margin + 45, margin + 305, margin + 410]` (col widths 45 / 260 / 105 / 105 over `contentWidth` 515). CANT centered or right-aligned in its cell (match how the current CANT cell aligns); PRECIO/SUBTOTAL right-aligned (existing `drawTextRight`).
  - **Frame helper** (local to `generateFacturaPDF`):
    ```ts
    const closeTableFrame = (pg: typeof page, topY: number, bottomY: number, colXs: number[]): void => {
      pg.drawRectangle({ x: margin, y: bottomY, width: contentWidth, height: topY - bottomY, borderColor: MONO.ink, borderWidth: RULE_WIDTH })
      for (const cx of colXs) drawVLine(pg, cx, topY, bottomY)
    }
    ```
  - **Items table**: record `tableTop` just above the header row; header row separated by its existing rule. On each pagination break: BEFORE calling `startContinuationPage(drawItemsTableHeader)`, call `closeTableFrame(page, tableTop, y - 4, itemColXs)`; AFTER it returns, reset `tableTop` to the new header-row top. After the last row, close the final chunk's frame.
  - **HISTORIAL DE PAGOS**: same mechanism with its own column x-boundaries (derive from the existing `colFechaX…colSaldoR` constants at 3668-3708) and `drawPagosTableHeader`.
  - **Money rows / saldo bar / badge / recibí conforme / footer**: untouched — verify by diff that no line in 3790-4008 changed except the pagos-frame additions.

- [ ] **Step 4: Run to verify GREEN** — `npx vitest run __tests__/lib/factura-pdf-venta.test.ts`. Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/pdf.ts __tests__/lib/factura-pdf-venta.test.ts
git commit -m "feat(pdf): framed ruled items and payments tables with continuation frames"
```

---

### Task 7: Field sweep + full regression + samples

**Files:**
- Read: `lib/pdf.ts` (FacturaPDFData 3385-3436 vs every draw site in generateFacturaPDF)
- Possibly modify: `__tests__/pdf-samples.test.ts` sample inputs (add the two new fields so samples show them)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Field sweep (the 2026-08-11 gotcha)** — for EVERY field of `FacturaPDFData` (all 30+, including `descuento`, `redondeo`, `moneda`, `zonaHoraria`, `logoUrl`, `vencimiento`, `mediosPago`, `cbuAlias`, every `cliente.*`, `orden.*`, `venta.*`, every pago field incl. `cuotas`/`recargoPorcentaje`/`montoOriginal`), grep generateFacturaPDF for a draw/use site. Report any field that lost its draw site in the rewrite — that is a bug to fix before proceeding.

- [ ] **Step 2: Update samples** — add `ingresosBrutosEmpresa` / `inicioActividadesEmpresa` to the fixture in `__tests__/pdf-samples.test.ts` so generated samples exercise the new header. Run `npx vitest run __tests__/pdf-samples.test.ts` and report the output path of the generated PDFs.

- [ ] **Step 3: Full test run** — `npm run test:run` (single process, never concurrent). Expected: ALL PASS. Fix any regression before committing.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(pdf): field sweep and classic remito samples"
```

---

## Delivery note (for the finishing step, not for task executors)

Total diff will exceed 400 lines. Natural chained split if requested at PR time: PR1 = Tasks 1-3 (data plumbing, independently shippable — fields simply don't render yet), PR2 = Tasks 4-7 (layout). Decide at finishing time with the user; implementation order above already respects that boundary.
