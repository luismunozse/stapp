# Accounting-Grade Remito Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the REMITO PDF as a collections document (saldo pendiente as protagonist, payment instructions, running balance, recibí conforme) in two chained PRs: PDF+existing-data first, then the fiscal/payment org fields with migration.

**Architecture:** All changes centre on `generateFacturaPDF` (lib/pdf.ts, monochrome house style via `lib/pdf-style.ts`). Slice 1 adds optional fields to `FacturaPDFData` and renders new blocks conditionally — so Slice 2 (migration + config UI + route pass-through) ships data without touching the PDF again. Branch `feat/remito-contable` (spec already committed) → PR slice 1 → branch `feat/remito-contable-datos` → PR slice 2.

**Tech Stack:** pdf-lib + `lib/pdf-style.ts` (`MONO`, `TYPE`, `RULE_WIDTH`, `drawRule {dotted?, color?, thickness?}`, `drawSectionLabel`→width, `drawOutlinedBadge`, `measureBadgeWidth`), vitest + `extractPdfText` (multi-page capable), Supabase migrations applied manually via `scripts/db-run.mjs` (dry-run default).

**Spec:** `docs/superpowers/specs/2026-08-11-remito-contable-redesign-design.md`

## Global Constraints

- Monochrome house style: MONO palette only; the single `MONO.totalBg` area fill MOVES from the TOTAL row to the SALDO PENDIENTE bar (TOTAL becomes a plain bold row). Single-drawText strings; hairline row separators at `y + 10`; section headings via `drawSectionLabel`; badges via `drawOutlinedBadge`.
- Verified facts (do not re-derive): `clientes.dni` EXISTS (supabase/migrations/001_schema.sql:164). `FacturaPDFData` is at lib/pdf.ts:2863-2901 (cliente has NO dni field yet; single `fecha` field; items have NO sku/bonif — do NOT invent columns). `estadoPagoLabels` at lib/pdf.ts:2903. Latest merged migration = 293; 294 is claimed by open PR #283 — new migration files use 295 and note that the number is finalized at merge time per repo convention.
- Every new PDF block is CONDITIONAL: absent data ⇒ block not drawn ⇒ existing fixtures render without it. Existing tests must stay green untouched except where this plan says to extend them.
- Pagination behavior (continuation pages, per-page footer, Página N de M) must keep working; new blocks (condiciones, recibí conforme) participate in the overflow math (add their heights to the kept-together tail block).
- Preserve: venta vs orden branches, ANULADA behavior (estado badge unchanged; saldo shown as `max(0, total - montoAbonado)`), overflow guards, signatures/QR (none in this doc), routes/function/DB names.
- Run vitest one file at a time; full suite via plain `npx vitest run` (exclude fix is merged). Known flake: exports-security timeout under load — isolated re-run once if it trips.
- Conventional commits; never add Co-Authored-By or AI attribution. Bash syntax for commands.
- Shared working tree: before each commit `git log --oneline -3`; unrelated commit on top → STOP and report.
- Migrations: author SQL only — NEVER run against the DB; the user applies them manually (scripts/db-run.mjs, dry-run first). Include a `rollback/` companion following the existing pattern in supabase/migrations/rollback/.

## File Structure

- Modify: `lib/pdf.ts` — `FacturaPDFData` interface + `generateFacturaPDF` body only.
- Modify: `__tests__/lib/factura-pdf-venta.test.ts` (extend), `__tests__/pdf-samples.test.ts` (fixture enrichment).
- Modify: `app/api/facturacion/[id]/pdf/route.ts` (pass existing + new data).
- Create (slice 2): `supabase/migrations/295_datos_fiscales_cobro_organizations.sql` + rollback; modify `components/configuracion/configuracion-form.tsx`, `app/api/configuracion/route.ts`.

---

### Task 1: Interface + money block (SALDO protagonist) + dual dates (PR slice 1)

**Files:**
- Modify: `lib/pdf.ts` (`FacturaPDFData` lib/pdf.ts:2863-2901; money-block section of `generateFacturaPDF`)
- Test: `__tests__/lib/factura-pdf-venta.test.ts`

**Interfaces:**
- Consumes: current `FacturaPDFData`, pdf-style exports.
- Produces (later tasks rely on these exact optional fields): `fechaOperacion?: Date | string`; `cliente.dni?: string | null`; `cuitEmpresa?: string | null`; `condicionIvaEmpresa?: string | null`; `domicilioFiscalEmpresa?: string | null`; `vencimiento?: Date | string | null`; `mediosPago?: string | null`; `cbuAlias?: string | null`.

- [ ] **Step 1: Failing tests first (TDD — behavior change).** Extend the factura test file using its existing fixture builders:

```ts
it("makes saldo pendiente the highlighted figure for partial payments", async () => {
  const buffer = await generateFacturaPDF(/* fixture: total 1000, montoAbonado 400, PAGADO_PARCIAL */)
  const text = await extractPdfText(buffer)
  expect(text).toContain("SALDO PENDIENTE")
  expect(text).toContain("Pagado a cuenta")
})

it("shows saldo 0 when fully paid", async () => {
  const buffer = await generateFacturaPDF(/* fixture PAGADO, montoAbonado === total */)
  const text = await extractPdfText(buffer)
  expect(text).toContain("SALDO")
})

it("renders emission and operation dates when fechaOperacion is provided", async () => {
  const buffer = await generateFacturaPDF({ ...fixture, fechaOperacion: new Date("2026-08-01") })
  const text = await extractPdfText(buffer)
  expect(text).toContain("Emisión")
  expect(text).toContain("Operación")
})
```

Run → new tests FAIL (SALDO PENDIENTE not drawn yet), existing PASS. Do not commit red.

- [ ] **Step 2: Implement.** Add the 8 optional fields to `FacturaPDFData`. Money block: rows Subtotal / IVA(>0) / Descuento / Redondeo unchanged; TOTAL becomes a plain right-aligned bold row (delete its `MONO.totalBg` rect); add row `Pagado a cuenta` (always, `montoAbonado`); add the `MONO.totalBg` bar with `SALDO PENDIENTE` + `max(0, total - montoAbonado)` at `TYPE.total` bold (label just `SALDO` when 0). Dates: `Fecha:` line becomes `Emisión: {fecha}` and, when `fechaOperacion` present, a second line `Operación: {fechaOperacion}` (8pt, `MONO.label`, same right block). Keep pagination tail-block math correct (`totalsBlockH` grows by the new rows — recompute the constant and its comment).
- [ ] **Step 3: Verify** `npx vitest run __tests__/lib/factura-pdf-venta.test.ts` → all green (old + new).
- [ ] **Step 4: Commit** `feat(pdf): make saldo pendiente the remito money protagonist with dual dates`.

---

### Task 2: Receptor DNI + emisor fiscal block + condiciones de pago (conditional) (PR slice 1)

**Files:**
- Modify: `lib/pdf.ts` (`generateFacturaPDF` header/receptor area + a new CONDICIONES DE PAGO section)
- Test: `__tests__/lib/factura-pdf-venta.test.ts`

**Interfaces:**
- Consumes: Task 1's interface fields.
- Produces: drawn blocks — EMISOR extras under company name (`CUIT: {cuit}` / `{condicionIva}` / `{domicilioFiscal}` 8pt `MONO.label`, each line only when present); RECEPTOR `DNI/CUIT: {dni}` line in the CLIENTE block when present; `CONDICIONES DE PAGO` section (drawSectionLabel heading) with lines `Vencimiento: {date}`, `Medios de pago: {text}`, `CBU/Alias: {text}` — section drawn only if at least one field present, placed after the money block, before HISTORIAL.

- [ ] **Step 1: Failing tests first.**

```ts
it("renders fiscal identity and payment conditions when provided", async () => {
  const buffer = await generateFacturaPDF({ ...fixture,
    cuitEmpresa: "30-71234567-8", condicionIvaEmpresa: "Responsable Inscripto",
    cliente: { ...fixture.cliente, dni: "28.456.789" },
    vencimiento: new Date("2026-09-10"), mediosPago: "Efectivo, transferencia", cbuAlias: "stapp.taller.mp" })
  const text = await extractPdfText(buffer)
  for (const s of ["CUIT: 30-71234567-8", "Responsable Inscripto", "DNI/CUIT: 28.456.789",
                   "CONDICIONES DE PAGO", "Vencimiento", "stapp.taller.mp"]) expect(text).toContain(s)
})

it("omits the conditional blocks when data is absent", async () => {
  const buffer = await generateFacturaPDF(baseFixture())
  const text = await extractPdfText(buffer)
  expect(text).not.toContain("CONDICIONES DE PAGO")
  expect(text).not.toContain("CUIT:")
})
```

- [ ] **Step 2: Implement** per the Produces block. CONDICIONES participates in overflow math (if it doesn't fit with the tail block, it moves to the continuation page together with it).
- [ ] **Step 3: Verify** the file's suite green.
- [ ] **Step 4: Commit** `feat(pdf): add fiscal identity and payment conditions blocks to remito`.

---

### Task 3: Saldo corrido + recibí conforme + route pass-through of existing data (PR slice 1)

**Files:**
- Modify: `lib/pdf.ts` (HISTORIAL table + new signature block)
- Modify: `app/api/facturacion/[id]/pdf/route.ts` (pass `cliente.dni` and `fechaOperacion` from existing DB data)
- Test: `__tests__/lib/factura-pdf-venta.test.ts`

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces: HISTORIAL DE PAGOS gains right-most `Saldo` column (running balance: start at `total`, subtract each pago; existing columns shift left proportionally — verify no overlap at 80mm... it is A4: keep columns inside contentWidth). RECIBÍ CONFORME block (orden-sourced only): `drawSectionLabel("Recibí conforme")`, ink underline via `drawRule {color: MONO.ink}` + `Firma` caption, second underline + `Aclaración` caption, drawn after HISTORIAL before the footer, participates in tail-block math. Route: `fechaOperacion` = the source venta's/orden's creation date (fields already selected in the route's queries — reuse; extend the select only if missing), `cliente.dni` from the clientes join.

- [ ] **Step 1: Failing tests first.** Running balance: fixture total 1000, pagos [300, 200] → text contains the running values formatted by the doc's currency formatter (700 then 500 — assert on distinctive formatted strings); recibí conforme present for orden-sourced fixture, absent for venta-sourced.
- [ ] **Step 2: Implement** PDF changes; then the route pass-through (read the route's existing queries first — clientes dni may already be selected).
- [ ] **Step 3: Verify** factura tests + `npx vitest run __tests__/api/facturacion.test.ts` (route touched) + tsc.
- [ ] **Step 4: Commit** `feat(pdf): add running balance and recibi conforme to remito`.

---

### Task 4: Samples + full suite + USER VISUAL GATE + PR slice 1

- [ ] **Step 1:** Enrich `__tests__/pdf-samples.test.ts` remito fixtures with the new fields (fiscal identity, condiciones, dni, fechaOperacion; the orden-sourced ENTREGADO sample gains recibí conforme). Regenerate: `PDF_SAMPLES=1 npx vitest run __tests__/pdf-samples.test.ts` → eyeball `after-remito.pdf` + `after-remito-largo.pdf` (pagination with the new tail blocks!).
- [ ] **Step 2:** Full suite `npx vitest run` → green. Commit `test(pdf): enrich remito samples with fiscal and payment data`.
- [ ] **Step 3: USER VISUAL GATE (blocking)** — present before/after remito PDFs. Apply feedback.
- [ ] **Step 4:** Push + PR `feat/remito-contable` → main: title `feat(pdf): accounting-grade remito with saldo, payment conditions and recibi conforme`.

---

### Task 5: Migration 295 + rollback (PR slice 2)

**Files:**
- Create: `supabase/migrations/295_datos_fiscales_cobro_organizations.sql`
- Create: `supabase/migrations/rollback/295_rollback.sql` (match existing rollback naming pattern — check the dir)
- Branch: `feat/remito-contable-datos` off `feat/remito-contable`.

- [ ] **Step 1:** Author the migration (SQL only, never executed here):

```sql
-- 295: fiscal identity + collection data for organizations, and remito wording in RPC errors
-- Number finalized at merge time (294 is claimed by open PR #283).
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS cuit TEXT,
  ADD COLUMN IF NOT EXISTS condicion_iva TEXT,
  ADD COLUMN IF NOT EXISTS domicilio_fiscal TEXT,
  ADD COLUMN IF NOT EXISTS cbu_alias TEXT,
  ADD COLUMN IF NOT EXISTS medios_pago_texto TEXT,
  ADD COLUMN IF NOT EXISTS plazo_pago_dias INTEGER;
```

Plus: re-create `anular_factura_atomica` (find its latest definition — migrations 248/269/292) changing ONLY the user-facing `RAISE EXCEPTION` strings ("La factura ya esta anulada" → "El remito ya esta anulado", etc.); copy the function body verbatim otherwise. Check `__tests__/api/factura-anular-atomica.test.ts` substring matching (`msg.includes("no encontrada")`) still holds; update mocks/tests if they pin the old wording.
- [ ] **Step 2:** `npx vitest run __tests__/api/factura-anular-atomica.test.ts` + full suite green (JS side unaffected by unapplied SQL — this validates test mocks only).
- [ ] **Step 3:** Commit `feat(db): add fiscal and collection fields to organizations with remito RPC wording`.

---

### Task 6: Config UI + API + route pass-through of org fields (PR slice 2)

**Files:**
- Modify: `components/configuracion/configuracion-form.tsx` (new "Datos fiscales y de cobro" card: cuit, condición IVA select [Responsable Inscripto / Monotributo / Exento / Consumidor Final], domicilio fiscal, CBU/alias, medios de pago, plazo de pago días)
- Modify: `app/api/configuracion/route.ts` (persist the new fields)
- Modify: `app/api/facturacion/[id]/pdf/route.ts` (org join gains the new columns; map to `cuitEmpresa`/`condicionIvaEmpresa`/`domicilioFiscalEmpresa`/`cbuAlias`/`mediosPago`; `vencimiento` computed = emisión + `plazo_pago_dias` when set)
- Tests: extend the existing configuracion/facturacion test files per their established mock patterns.

- [ ] **Step 1: Tests first** (component: card renders + submits new fields; route: PDF data includes org fiscal fields when present in the mocked org row).
- [ ] **Step 2: Implement.** UI copy in neutral Spanish matching the surrounding form.
- [ ] **Step 3:** Touched files green + full suite + tsc.
- [ ] **Step 4:** Commit `feat(configuracion): fiscal identity and collection settings feeding the remito`.

---

### Task 7: Final review + PR slice 2

- [ ] **Step 1:** Whole-branch review of `feat/remito-contable-datos` (fresh context, most capable model).
- [ ] **Step 2:** Push + PR → `feat/remito-contable` (chained; note merge order and the branch-deletion gotcha in the body). Remind the user: migration 295 must be applied manually (`node scripts/db-run.mjs supabase/migrations/295_... --dry-run` first), and renumber if #283's 294 lands first.
