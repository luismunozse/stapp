# Onboarding multi-rubro, PR 2: Rubro Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an ADMIN change the org's rubro from the onboarding wizard while the shop has no real orders, leaving the org exactly as a fresh signup with the new rubro would, without duplicating or deleting anything.

**Architecture:** A new server-only module `lib/rubros/cambio.ts` runs the change. It reuses two building blocks exported from `lib/rubros/seed.ts` (`filasDeTipos`, `sembrarChecklists`) but has its own failure contract: a failed tipos upsert aborts before any other write, and any later DB error throws. `seedOrganizationFromRubro` and the signup are untouched. A thin route, `PUT /api/onboarding/rubro`, handles auth, validation (the signup's own `validarSeleccionRubro`), the 409 real-order guard, the same-rubro no-op, and the call to PR 1's `deletePracticeData`.

**Tech Stack:** Next.js 16 route handlers, supabase-js (`supabaseAdmin`, typed `SupabaseClient<any>`), zod 3, Vitest 4 (jsdom, globals).

**Spec:** `docs/superpowers/specs/2026-10-11-onboarding-multirubro-design.md`, section "Server → `PUT /api/onboarding/rubro`". Also its "Error handling" and "Testing → Rubro change" rows.

## Global Constraints

- **Strict TDD:** every behavior gets a failing test first. Run it and see it fail for the stated reason. Write the minimal code. Run it and see it pass. Then commit. Tests labeled "guard" are the exception: they pin a decision the implementation could break, pass before it exists, and must stay green after.
- **Commits:** conventional commits in English. NO "Co-Authored-By" and no AI attribution of any kind. One commit per task (a reviewable work unit).
- **Definition of done:**
  - `npx vitest run` with the touched suites green, then the full run green.
  - `npx tsc --noEmit` clean. Lint does not check types.
  - `npx eslint lib/rubros app/api/onboarding/rubro __tests__/lib/rubros-cambio.test.ts __tests__/api/onboarding-rubro.test.ts` clean.
  - Never `npm run lint`: it walks every worktree and never ends.
- **`rg` usage:** always pass an explicit path, for example `rg -n "pattern" lib app`. In a pipe, use `-`. Never a bare `rg "pattern"`: the repo root holds `.env*` secrets and the implicit `.` walk triggers a permission prompt.
- **Never read `.env*` files.** The repo is public.
- **Pure modules stay pure:**
  - `lib/terminologia.ts`, `lib/rubros/index.ts`, `lib/rubros/detalle.ts` and `lib/rubros/seleccion.ts` stay client-safe, with no supabase import.
  - Server fetches of terminology go in `lib/terminologia-server.ts`. This PR touches neither file.
  - `lib/rubros/cambio.ts` is server-only, because it reaches `supabaseAdmin` through `seed.ts`. It must never be imported from `components/` or any `"use client"` file.
- **Signup behavior unchanged:**
  - `seedOrganizationFromRubro` keeps its body and contract.
  - `__tests__/lib/rubros-seed.test.ts` and `__tests__/api/register-rubro.test.ts` are not edited, and stay green after every task.
- **Never delete** `tipos_dispositivo` or `checklist_templates` rows in this path. Deactivate them (`activo = false`).
- **User-facing copy** is Spanish with voseo, exactly as written in this plan. Code comments and test names are English. Identifiers in `lib/rubros` follow that module's existing Spanish naming.
- **Dependency on PR 1:**
  - Task 3 needs PR 1 merged: `lib/onboarding/practica.ts` exporting `deletePracticeData`, and the `ordenes_servicio.es_practica` column applied in production.
  - Tasks 1 and 2 do not depend on PR 1.
  - Create the branch (suggested `feat/onboarding-cambio-rubro`) from `origin/main` once PR 1 is merged.
- **No migration, no database commands, no scripts against production** in this PR.

## Review Focus

1. **Round trip between two rubros.** Example: electrodomésticos → electrónica → electrodomésticos.
   - Every deactivated tipo and checklist comes back active.
   - No checklist row is duplicated.
   - A unique-key collision never silently drops a typed checklist.
   - Pinned in Task 1 Step 7 and Task 2 Step 6.
2. **Re-submitting the current rubro.** A double click, or picking the same card again.
   - Answers 200 with no writes.
   - Keeps the practice order.
   - Keeps any vocabulary the shop edited by hand.
   - Pinned in Task 3 Step 13.
3. **A failed real-order count.** It must fail closed (500) and never read as "zero real orders". Pinned in Task 3 Step 9.
4. **Genérico → genérico with a retyped trade.**
   - When the derived code is the same, the tipo's name is refreshed and the checklist is kept, not duplicated.
   - When the code is different, "Recepción" moves to the new tipo and the old one is retired.
   - Pinned in Task 1 Step 7 and Task 2 Steps 1 and 6.
5. **Data the shop created by hand.**
   - Custom tipos (`es_base = false`) and the shop's own checklists stay active.
   - Nothing is deleted, so inventory FKs and quote checklist snapshots keep resolving.
   - Pinned in Task 1 Step 1 and Task 2 Step 1.

---

## Verified facts (cite when reviewing)

| Fact | Evidence |
|---|---|
| Signup upsert ignores existing codes, so it neither reactivates nor refreshes | `lib/rubros/seed.ts:76-78` (`ignoreDuplicates: true`) |
| Signup skips the terminology write for an empty pack | `lib/rubros/seed.ts:119`; pinned by `__tests__/lib/rubros-seed.test.ts:138-141` |
| Signup checklists are insert-only | `lib/rubros/seed.ts:189-198` |
| Signup seed never throws; it accumulates `errors` | `lib/rubros/seed.ts:38-56` |
| `tipos_dispositivo` key is `UNIQUE(organization_id, codigo)` | `supabase/migrations/014_tipos_dispositivo_custom.sql:19` |
| `ordenes_servicio.tipo_dispositivo_id` and `inventario.tipo_dispositivo_id` are FKs with no ON DELETE, so a delete is blocked while referenced | `014_tipos_dispositivo_custom.sql:70,74` |
| `checklist_templates.tipo_dispositivo_id` is `ON DELETE SET NULL`. Deleting a tipo would turn its checklist into one for every tipo | `050_checklist_per_device_type.sql:3` |
| `checklist_templates` key is `UNIQUE(organization_id, nombre, tipo_dispositivo_id)`. NULLs are distinct, so a re-seed **duplicates** untyped templates and **fails with 23505** on typed ones | `050_checklist_per_device_type.sql:7-10` |
| `checklist_templates.activo` exists. Items cascade on delete. `checklist_recepcion.template_id` has no ON DELETE, and `checklist_recepcion.orden_id` cascades from the order | `001_schema.sql:414,429,442-443` |
| Quotes reference a template **by id with no FK**. A deleted template silently drops the checklist values from the quote PDF and from the converted order | `lib/cotizacion-pdf.ts:44-52`; `app/api/cotizaciones/[id]/convertir-orden/route.ts:207-224` |
| The app never deletes a base tipo, it deactivates it | `app/api/tipos-dispositivo/[id]/route.ts:170-184` |
| The order number prefix lookup requires `activo = true`, so a pack code left inactive breaks numbering | `lib/counters.ts:31-37` |
| `ensureTiposExist` counts ALL tipos, active or not, so deactivating never triggers its re-seed | `app/api/tipos-dispositivo/route.ts:55-61` |
| `GET /api/tipos-dispositivo` defaults to `activo = true` and hides `TODOS` | `app/api/tipos-dispositivo/route.ts:93-99` |
| Checklist selection at order intake filters `activo = true` | `app/api/checklist-templates/by-device-type/route.ts:19-53`; `app/api/ordenes/[id]/checklist/route.ts:63-97` |
| `organizations.terminologia` is `JSONB NOT NULL DEFAULT '{}'` | `supabase/migrations/263_organizations_terminologia.sql:7` |
| `organizations.rubro` comes from migration 307, which backfilled `electronica` | `307_organizations_rubro.sql:17,24` |
| `rubro_detalle` comes from migration **308** (not 307), and is "NULL si eligió un pack curado" | `308_organizations_rubro_detalle.sql:16,18-19` |
| The signup form validates with `validarSeleccionRubro`: a known id, and genérico needs a usable trade | `lib/rubros/seleccion.ts:13-39`; `app/(auth)/registro/page.tsx:173,223` |
| The register API is permissive: an unknown id gives 400, but an empty rubro falls back to genérico. Detalle is max 120 and not required | `app/api/auth/register/route.ts:23-32,73-78` |
| `requireAdmin` answers 401 without a session and 403 for a non-ADMIN | `lib/auth-utils.ts:20-30,55-69` |
| No cache layer holds tipos or terminology, so nothing needs revalidating | `rg -n "unstable_cache" app`: only catalog, dashboard stats, subscription |
| Orgs registered before 2026-08-23 got a hardcoded "Checklist de Recepción" that no pack names | `git show 469ba6e6 -- app/api/auth/register/route.ts` |
| Vitest command | `package.json:11` (`"test:run": "vitest run"`); `vitest.setup.ts:48-88` globally mocks `@/lib/auth` and `@/lib/supabase` |

## Decisions

1. **A separate module, not a `replace` mode in `seed.ts`.**
   - Signup must never throw or abort. The rubro change must abort on a tipos failure and throw on any later one.
   - A mode flag would put both contracts in one function, branching at every step. It would also force edits to a function whose current tests are the proof that signup did not change.
   - `seed.ts` only gains two exports: `filasDeTipos`, extracted from `sembrarTipos`, and `sembrarChecklists`, which only gains the `export` keyword.
2. **Deactivate, never delete, for both tipos and checklist templates.**
   - Inventory may reference old tipos. Its FK has no ON DELETE.
   - Quotes may reference old templates by id with no FK, and a delete would silently drop recorded checklist values.
   - Deactivating needs no proof of non-reference and matches the app's own rule for base tipos.
3. **The tipos upsert overwrites (`ignoreDuplicates` omitted) in this path only.**
   - The `ON CONFLICT DO UPDATE` writes the pack's row, `activo: true` included.
   - In one atomic statement, it seeds new codes, reactivates codes a previous change deactivated, and refreshes names. That last part covers genérico "maquinas de cafe" → "máquinas de café", which derive the same code.
   - Base tipos not in the new pack are then deactivated. Custom tipos (`es_base = false`) are never touched.
4. **Checklists: reuse or insert by `(nombre, tipo_dispositivo_id)`, then retire.**
   - Templates are read once, BEFORE inserting.
   - A template of the new pack that already exists is kept, and reactivated if needed.
   - Only the missing ones go through the signup's `sembrarChecklists`.
   - Templates whose `nombre` belongs to the PREVIOUS pack and that were not kept are deactivated.
   - This avoids both failure modes of the unique key: the NULL duplicates and the 23505 on typed ones.
   - Item insert errors stay non-fatal and are logged, as at signup.
5. **The previous pack is resolved before any write.**
   - The route reads `organizations.rubro` and `rubro_detalle` before calling anything.
   - `cambio.ts` builds `packAnterior` on its first line.
   - Terminology, `rubro` and `rubro_detalle` go in ONE final UPDATE (spec steps 5 and 6), so a retry of the same request after a partial failure still resolves the same previous pack and converges.
6. **Same rubro short-circuits.**
   - For a curated pack, "same" means the same id. For genérico, it also means the same trimmed `rubroDetalle`.
   - The route answers 200 with the current `tiposActivos` and writes nothing. It does not call `deletePracticeData`, and does not overwrite vocabulary the shop customized.
   - The 409 check still runs first.
7. **Validation reuses the signup form's rule.**
   - `validarSeleccionRubro` applies, with the register API's 120-character limit.
   - The register API itself is permissive because other signup paths have no picker. The wizard always shows one, so this endpoint is strict.
   - For a curated pack, `rubro_detalle` is stored as `null`, per the column comment.
8. **`tiposActivos` is the number of active tipos without `TODOS`.** That is what `GET /api/tipos-dispositivo` lists by default, and what the shop can pick.

## Accepted risks (no test)

- **Concurrency.** A real order created between the 409 check and the end of the change is not guarded. The wizard is single-admin and pre-first-order.
- **Retry with a different rubro.** After a partial failure past the tipos step, the route answers 500. Retrying the same request converges. Retrying with a different rubro can leave the abandoned pack's untyped checklist active, and the shop can remove it from Configuración.
- **Practice lost on a failed seed.** The spec orders `deletePracticeData` first. If the tipos upsert then fails, the practice is already gone. The wizard recreates it on the next "Recibir".
- **Legacy orgs.** Orgs registered before 2026-08-23 keep their hardcoded "Checklist de Recepción" active, because no pack names it.

## File Structure

| File | Responsibility |
|---|---|
| `lib/rubros/seed.ts` (modify) | Export `filasDeTipos` (extracted) and `sembrarChecklists` (now exported). Nothing else changes |
| `lib/rubros/cambio.ts` (create) | The rubro change: `aplicarCambioDeRubro`, `contarTiposActivos`, `mismoRubro`, `SeleccionRubro` |
| `app/api/onboarding/rubro/route.ts` (create) | `PUT`: auth, validation, 409 guard, same-rubro no-op, practice deletion, change, response |
| `__tests__/lib/rubros-cambio.test.ts` (create) | Stateful in-memory supabase fake. The org is seeded by the real signup seed, then changed, then asserted |
| `__tests__/api/onboarding-rubro.test.ts` (create) | Route tests with the shared chain mocks; the lib and PR 1's helper are mocked |

Estimated diff: about 330 production lines and about 690 test lines, roughly 1,000 changed lines in total. That exceeds the 400-line review budget. See "Decision needed" below.

**Decision needed before apply:** pick one of these.
- **(a) One PR labeled `size:exception`.** Recommended. Production code is about 330 lines, and the rest is tests. `lib/rubros/cambio.ts` has no consumer without the route.
- **(b) Split at the task boundary.** 2a is Tasks 1-2 (about 640 lines, still over budget). 2b is Task 3 (about 380 lines). The tasks already support this split.

---

### Task 1: Tipos and vocabulary replacement

**Files:**
- Modify: `lib/rubros/seed.ts:58-85` (extract the row mapping out of `sembrarTipos`)
- Create: `lib/rubros/cambio.ts`
- Test: `__tests__/lib/rubros-cambio.test.ts`

**Interfaces:**
- Consumes:
  - `getRubro(id: string | null | undefined): RubroPack` from `lib/rubros/index.ts:41`
  - `personalizarPack(pack: RubroPack, detalle: string | null | undefined): RubroPack` from `lib/rubros/detalle.ts:156`
  - `seedOrganizationFromRubro(organizationId, rubroId, client, detalle)` from `lib/rubros/seed.ts:27`, used by tests only to build the starting state
- Produces:
  - `export function filasDeTipos(organizationId: string, pack: RubroPack)` in `seed.ts`. It returns the `tipos_dispositivo` rows: `organization_id`, `codigo`, `nombre`, `prefijo_orden`, `icono`, `activo: true`, `es_base: true`, `orden`, `config`.
  - `export interface SeleccionRubro { rubro: string | null; rubroDetalle: string | null }`
  - `export async function aplicarCambioDeRubro(organizationId: string, anterior: SeleccionRubro, nuevo: SeleccionRubro, client?: typeof supabaseAdmin): Promise<{ tiposActivos: number }>`. It throws on any DB error. A failed tipos upsert throws before any other write.
  - `export async function contarTiposActivos(organizationId: string, client?: typeof supabaseAdmin): Promise<number>`
  - Private `reemplazarTipos(...)`, which returns `Map<string, string>` (codigo → id), and private `actualizarActivo(client, tabla, organizationId, ids, activo)`. Task 2 uses both.

- [ ] **Step 0: Baseline**

Run: `npx vitest run __tests__/lib/rubros-seed.test.ts __tests__/api/register-rubro.test.ts`
Expected: PASS (all tests). If modules fail to resolve, the worktree has no healthy `node_modules`; fix that before starting.

- [ ] **Step 1: Write the stateful fake, the fixture and the first tipos tests**

Create `__tests__/lib/rubros-cambio.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { seedOrganizationFromRubro } from "@/lib/rubros/seed"
import { aplicarCambioDeRubro, type SeleccionRubro } from "@/lib/rubros/cambio"
import { getRubro } from "@/lib/rubros"

/**
 * In-memory stand-in for the slice of supabase-js the rubro change touches.
 * Unlike the recorder in rubros-seed.test.ts it keeps STATE: the org is seeded
 * by the real signup seed, changed, and then the tables are asserted.
 */
type Row = Record<string, any>
type Op = "select" | "insert" | "upsert" | "update" | "delete"
interface Resultado {
  data: any
  error: { message: string; code?: string } | null
}

const clonar = <T>(valor: T): T => JSON.parse(JSON.stringify(valor))

function crearDbFake(inicial: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = clonar(inicial)
  /** "table.op" -> error message that operation returns. */
  const failures: Record<string, string> = {}
  const calls: Array<{ table: string; op: Op }> = []
  let seq = 0

  const tabla = (nombre: string): Row[] => (tables[nombre] ??= [])

  // The two unique keys that shape the bug: tipos (migration 014:19) and
  // checklist templates (migration 050:8-10). A NULL tipo_dispositivo_id never
  // collides, as in Postgres.
  const choca = (nombre: string, fila: Row, contra: Row[]): Row | undefined => {
    if (nombre === "tipos_dispositivo") {
      return contra.find(
        (r) => r.organization_id === fila.organization_id && r.codigo === fila.codigo
      )
    }
    if (nombre === "checklist_templates" && fila.tipo_dispositivo_id != null) {
      return contra.find(
        (r) =>
          r.organization_id === fila.organization_id &&
          r.nombre === fila.nombre &&
          r.tipo_dispositivo_id === fila.tipo_dispositivo_id
      )
    }
    return undefined
  }

  class Query {
    private filtros: Array<(r: Row) => boolean> = []
    private unico = false

    constructor(
      private readonly nombre: string,
      private readonly op: Op,
      private readonly payload?: Row | Row[],
      private readonly ignorarDuplicados = false
    ) {}

    select() {
      return this
    }
    eq(col: string, valor: unknown) {
      this.filtros.push((r) => r[col] === valor)
      return this
    }
    in(col: string, valores: unknown[]) {
      this.filtros.push((r) => valores.includes(r[col]))
      return this
    }
    single() {
      this.unico = true
      return this
    }
    then(ok: (r: Resultado) => unknown, ko?: (e: unknown) => unknown) {
      return Promise.resolve()
        .then(() => this.ejecutar())
        .then(ok, ko)
    }

    private filasDelPayload(): Row[] {
      const p = this.payload ?? []
      return (Array.isArray(p) ? p : [p]).map((r) => ({ ...r }))
    }

    private ejecutar(): Resultado {
      calls.push({ table: this.nombre, op: this.op })
      const falla = failures[`${this.nombre}.${this.op}`]
      if (falla) return { data: null, error: { message: falla } }

      const filas = tabla(this.nombre)
      const coincide = (r: Row) => this.filtros.every((f) => f(r))

      if (this.op === "select") {
        const data = filas.filter(coincide).map((r) => ({ ...r }))
        return { data: this.unico ? (data[0] ?? null) : data, error: null }
      }
      if (this.op === "update") {
        for (const r of filas.filter(coincide)) Object.assign(r, this.payload)
        return { data: null, error: null }
      }
      if (this.op === "delete") {
        tables[this.nombre] = filas.filter((r) => !coincide(r))
        return { data: null, error: null }
      }
      if (this.op === "insert") {
        const nuevas = this.filasDelPayload()
        // One statement is atomic: a single collision rejects every row.
        const rechazo = nuevas.some((fila, i) =>
          choca(this.nombre, fila, [...filas, ...nuevas.slice(0, i)])
        )
        if (rechazo) {
          return {
            data: null,
            error: { code: "23505", message: "duplicate key value violates unique constraint" },
          }
        }
        const insertadas = nuevas.map((fila) => ({ id: `${this.nombre}-${++seq}`, ...fila }))
        filas.push(...insertadas)
        return { data: this.unico ? insertadas[0] : insertadas, error: null }
      }
      // upsert ON CONFLICT on the table's unique key
      for (const fila of this.filasDelPayload()) {
        const existente = choca(this.nombre, fila, filas)
        if (!existente) filas.push({ id: `${this.nombre}-${++seq}`, ...fila })
        else if (!this.ignorarDuplicados) Object.assign(existente, fila)
      }
      return { data: null, error: null }
    }
  }

  const client = {
    from: (nombre: string) => ({
      select: () => new Query(nombre, "select"),
      insert: (payload: Row | Row[]) => new Query(nombre, "insert", payload),
      upsert: (payload: Row | Row[], opciones?: { ignoreDuplicates?: boolean }) =>
        new Query(nombre, "upsert", payload, opciones?.ignoreDuplicates === true),
      update: (payload: Row) => new Query(nombre, "update", payload),
      delete: () => new Query(nombre, "delete"),
    }),
  }

  return { client, tables, failures, calls }
}

type FakeDb = ReturnType<typeof crearDbFake>

const ORG = "org-1"

/** The org exactly as the signup leaves it. */
async function orgSembradaCon(rubro: string, detalle: string | null = null): Promise<FakeDb> {
  const fake = crearDbFake({
    organizations: [{ id: ORG, rubro, rubro_detalle: detalle, terminologia: {} }],
  })
  const seed = await seedOrganizationFromRubro(ORG, rubro, fake.client as any, detalle)
  expect(seed.errors).toEqual([])
  return fake
}

const sel = (rubro: string, rubroDetalle: string | null = null): SeleccionRubro => ({
  rubro,
  rubroDetalle,
})

const cambiar = (fake: FakeDb, de: SeleccionRubro, a: SeleccionRubro) =>
  aplicarCambioDeRubro(ORG, de, a, fake.client as any)

const codigosActivos = (fake: FakeDb) =>
  fake.tables.tipos_dispositivo
    .filter((t) => t.activo === true)
    .map((t) => t.codigo)
    .sort()

const codigosDe = (rubro: string) =>
  getRubro(rubro)
    .tipos.map((t) => t.codigo)
    .sort()

const org = (fake: FakeDb) => fake.tables.organizations[0]

vi.spyOn(console, "error").mockImplementation(() => {})

beforeEach(() => {
  vi.clearAllMocks()
})

describe("aplicarCambioDeRubro: tipos", () => {
  it("deactivates the previous pack's base tipos instead of leaving them active", async () => {
    const fake = await orgSembradaCon("electrodomesticos")

    await cambiar(fake, sel("electrodomesticos"), sel("electronica"))

    expect(codigosActivos(fake)).toEqual(codigosDe("electronica"))
    // Deactivated, not deleted: inventory may still reference it (migration 014:74).
    const heladera = fake.tables.tipos_dispositivo.find((t) => t.codigo === "HELADERA")
    expect(heladera?.activo).toBe(false)
  })

  it("leaves the tipos the shop created by hand alone", async () => {
    const fake = await orgSembradaCon("electrodomesticos")
    fake.tables.tipos_dispositivo.push({
      id: "t-dron",
      organization_id: ORG,
      codigo: "DRON",
      nombre: "Dron",
      es_base: false,
      activo: true,
    })

    await cambiar(fake, sel("electrodomesticos"), sel("electronica"))

    expect(fake.tables.tipos_dispositivo.find((t) => t.id === "t-dron")?.activo).toBe(true)
  })

  it("aborts with nothing changed when seeding the new tipos fails", async () => {
    const fake = await orgSembradaCon("electrodomesticos")
    fake.failures["tipos_dispositivo.upsert"] = "boom"
    const antes = clonar(fake.tables)

    await expect(
      cambiar(fake, sel("electrodomesticos"), sel("electronica"))
    ).rejects.toThrow("boom")

    expect(fake.tables).toEqual(antes)
  })

  it("returns how many tipos the shop can pick, without the internal TODOS", async () => {
    const fake = await orgSembradaCon("electrodomesticos")

    const result = await cambiar(fake, sel("electrodomesticos"), sel("electronica"))

    const esperados = getRubro("electronica").tipos.filter((t) => t.codigo !== "TODOS")
    expect(result.tiposActivos).toBe(esperados.length)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/lib/rubros-cambio.test.ts`
Expected: FAIL. The suite cannot load: `Failed to resolve import "@/lib/rubros/cambio"`.

- [ ] **Step 3: Extract `filasDeTipos` in `seed.ts` (refactor, no behavior change)**

In `lib/rubros/seed.ts`, replace the `sembrarTipos` function (lines 58-85) with:

```ts
/**
 * `tipos_dispositivo` rows for a pack. Shared by the signup seed and the rubro
 * change (lib/rubros/cambio.ts), so both write exactly the same shape.
 */
export function filasDeTipos(organizationId: string, pack: RubroPack) {
  return pack.tipos.map((tipo) => ({
    organization_id: organizationId,
    codigo: tipo.codigo,
    nombre: tipo.nombre,
    prefijo_orden: tipo.prefijoOrden,
    icono: tipo.icono ?? null,
    activo: true,
    es_base: true,
    orden: tipo.orden,
    config: tipo.config,
  }))
}

async function sembrarTipos(
  organizationId: string,
  pack: RubroPack,
  client: typeof supabaseAdmin,
  errors: string[]
): Promise<number> {
  const filas = filasDeTipos(organizationId, pack)

  const { error } = await client
    .from("tipos_dispositivo")
    .upsert(filas, { onConflict: "organization_id,codigo", ignoreDuplicates: true })

  if (error) {
    errors.push(`tipos_dispositivo: ${error.message}`)
    return 0
  }
  return filas.length
}
```

- [ ] **Step 4: Prove the signup did not change**

Run: `npx vitest run __tests__/lib/rubros-seed.test.ts __tests__/api/register-rubro.test.ts`
Expected: PASS, the same count as Step 0.

- [ ] **Step 5: Create `lib/rubros/cambio.ts` with the tipos replacement**

```ts
import { supabaseAdmin } from "@/lib/supabase"
import { getRubro } from "./index"
import { personalizarPack } from "./detalle"
import { filasDeTipos } from "./seed"
import type { RubroPack } from "./types"

/**
 * Rubro change for an org with no real orders yet (PUT /api/onboarding/rubro).
 *
 * It reuses the signup's building blocks from seed.ts but has the opposite
 * failure contract: the signup never throws and never aborts; here a failed
 * tipos upsert aborts before any other write, and every later DB error throws
 * so the route answers 500. Every step is idempotent and organizations.rubro is
 * written last, so retrying the same request converges.
 *
 * It never deletes, it deactivates: inventario.tipo_dispositivo_id references
 * tipos with no ON DELETE (migration 014), and quotes keep a checklist snapshot
 * that points at a template id with no FK (lib/cotizacion-pdf.ts).
 *
 * Server-only (supabaseAdmin). Never import it from a client component.
 */

export interface SeleccionRubro {
  rubro: string | null
  rubroDetalle: string | null
}

interface TipoExistente {
  id: string
  codigo: string
  es_base: boolean | null
  activo: boolean | null
}

export async function aplicarCambioDeRubro(
  organizationId: string,
  anterior: SeleccionRubro,
  nuevo: SeleccionRubro,
  client: typeof supabaseAdmin = supabaseAdmin
): Promise<{ tiposActivos: number }> {
  const packNuevo = personalizarPack(getRubro(nuevo.rubro), nuevo.rubroDetalle)

  await reemplazarTipos(organizationId, packNuevo, client)

  return { tiposActivos: await contarTiposActivos(organizationId, client) }
}

/**
 * Active tipos the shop can pick: what GET /api/tipos-dispositivo lists by
 * default (activo = true, without the internal TODOS).
 */
export async function contarTiposActivos(
  organizationId: string,
  client: typeof supabaseAdmin = supabaseAdmin
): Promise<number> {
  const { data, error } = await client
    .from("tipos_dispositivo")
    .select("codigo")
    .eq("organization_id", organizationId)
    .eq("activo", true)

  if (error) throw new Error(`tipos_dispositivo (conteo): ${error.message}`)
  return (data ?? []).filter((t: { codigo: string }) => t.codigo !== "TODOS").length
}

/** Seeds the new pack's tipos, deactivates the old base ones, returns codigo -> id. */
async function reemplazarTipos(
  organizationId: string,
  pack: RubroPack,
  client: typeof supabaseAdmin
): Promise<Map<string, string>> {
  const { error: upsertError } = await client
    .from("tipos_dispositivo")
    .upsert(filasDeTipos(organizationId, pack), {
      onConflict: "organization_id,codigo",
      ignoreDuplicates: true,
    })
  if (upsertError) throw new Error(`tipos_dispositivo: ${upsertError.message}`)

  const { data, error: readError } = await client
    .from("tipos_dispositivo")
    .select("id, codigo, es_base, activo")
    .eq("organization_id", organizationId)
  if (readError) throw new Error(`tipos_dispositivo (lectura): ${readError.message}`)

  const tipos = (data ?? []) as TipoExistente[]
  const codigosDelPack = new Set(pack.tipos.map((t) => t.codigo))

  // Only base tipos: the ones the shop created by hand never belonged to a pack.
  const aDesactivar = tipos
    .filter((t) => t.es_base === true && t.activo !== false && !codigosDelPack.has(t.codigo))
    .map((t) => t.id)
  await actualizarActivo(client, "tipos_dispositivo", organizationId, aDesactivar, false)

  return new Map(tipos.map((t) => [t.codigo, t.id]))
}

async function actualizarActivo(
  client: typeof supabaseAdmin,
  tabla: "tipos_dispositivo" | "checklist_templates",
  organizationId: string,
  ids: string[],
  activo: boolean
): Promise<void> {
  if (ids.length === 0) return

  const { error } = await client
    .from(tabla)
    .update({ activo })
    .eq("organization_id", organizationId)
    .in("id", ids)

  if (error) throw new Error(`${tabla} (activo = ${activo}): ${error.message}`)
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run __tests__/lib/rubros-cambio.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Write the reactivation and refresh tests**

Append to the `describe("aplicarCambioDeRubro: tipos")` block:

```ts
  it("reactivates the tipos an earlier change deactivated", async () => {
    const fake = await orgSembradaCon("electrodomesticos")

    await cambiar(fake, sel("electrodomesticos"), sel("electronica"))
    await cambiar(fake, sel("electronica"), sel("electrodomesticos"))

    expect(codigosActivos(fake)).toEqual(codigosDe("electrodomesticos"))
    expect(fake.tables.tipos_dispositivo.filter((t) => t.codigo === "HELADERA")).toHaveLength(1)
  })

  it("refreshes a tipo the new pack already had instead of keeping its old name", async () => {
    const fake = await orgSembradaCon("generico", "maquinas de cafe")

    await cambiar(fake, sel("generico", "maquinas de cafe"), sel("generico", "máquinas de café"))

    const maquinas = fake.tables.tipos_dispositivo.filter((t) => t.codigo === "MAQUINA_DE_CAFE")
    expect(maquinas).toHaveLength(1)
    expect(maquinas[0]).toMatchObject({ nombre: "Máquina de café", activo: true })
  })
```

- [ ] **Step 8: Run them to verify they fail**

Run: `npx vitest run __tests__/lib/rubros-cambio.test.ts -t "reactivates|refreshes"`
Expected: FAIL. Both fail because `ignoreDuplicates: true` skips existing codes:
- In the first test, `codigosActivos` is `[]`, because HELADERA and the other codes stay inactive.
- In the second test, `nombre` is still `"Maquina de cafe"`.

- [ ] **Step 9: Make the upsert overwrite**

In `lib/rubros/cambio.ts`, inside `reemplazarTipos`, replace the upsert statement with:

```ts
  // Unlike the signup, no ignoreDuplicates: ON CONFLICT DO UPDATE writes the
  // pack's row, activo = true included, in one atomic statement. A code an
  // earlier change deactivated comes back active and with the pack's name.
  const { error: upsertError } = await client
    .from("tipos_dispositivo")
    .upsert(filasDeTipos(organizationId, pack), { onConflict: "organization_id,codigo" })
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npx vitest run __tests__/lib/rubros-cambio.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 11: Write the vocabulary and rubro tests**

Append a new block to the test file:

```ts
describe("aplicarCambioDeRubro: vocabulary and rubro", () => {
  it("resets the vocabulary to {} when the new pack has no overrides", async () => {
    const fake = await orgSembradaCon("electrodomesticos")
    expect(org(fake).terminologia.equipo).toBe("Artefacto") // the signup wrote it

    await cambiar(fake, sel("electrodomesticos"), sel("electronica"))

    expect(org(fake).terminologia).toEqual({})
    expect(org(fake)).toMatchObject({ rubro: "electronica", rubro_detalle: null })
  })

  it("stores the genérico trade and the vocabulary derived from it", async () => {
    const fake = await orgSembradaCon("electronica")

    await cambiar(fake, sel("electronica"), sel("generico", "maquinas de cafe"))

    expect(org(fake)).toMatchObject({ rubro: "generico", rubro_detalle: "maquinas de cafe" })
    expect(org(fake).terminologia).toEqual({
      equipo: "Maquina de cafe",
      equipoPlural: "Maquinas de cafe",
    })
    expect(codigosActivos(fake)).toEqual(["MAQUINA_DE_CAFE"])
  })
})
```

- [ ] **Step 12: Run them to verify they fail**

Run: `npx vitest run __tests__/lib/rubros-cambio.test.ts -t "vocabulary"`
Expected: FAIL. In the first test, `terminologia` still holds `{ equipo: "Artefacto", ... }`. In the second, `rubro` is still `"electronica"`.

- [ ] **Step 13: Write the organization update**

In `lib/rubros/cambio.ts`, replace the body of `aplicarCambioDeRubro` with:

```ts
  const packNuevo = personalizarPack(getRubro(nuevo.rubro), nuevo.rubroDetalle)

  await reemplazarTipos(organizationId, packNuevo, client)

  // Spec steps 5 and 6 in one statement, written last. The terminology is
  // written even when it is {}: sembrarVocabulario in seed.ts skips that case,
  // so a shop leaving electrodomésticos kept saying "Artefacto".
  const { error } = await client
    .from("organizations")
    .update({
      terminologia: packNuevo.terminologia,
      rubro: nuevo.rubro,
      rubro_detalle: nuevo.rubroDetalle,
    })
    .eq("id", organizationId)
  if (error) throw new Error(`organizations: ${error.message}`)

  return { tiposActivos: await contarTiposActivos(organizationId, client) }
```

- [ ] **Step 14: Run the new suite and the signup suites**

Run: `npx vitest run __tests__/lib/rubros-cambio.test.ts __tests__/lib/rubros-seed.test.ts __tests__/api/register-rubro.test.ts`
Expected: PASS. `rubros-cambio` has 8 tests, and the signup suites are unchanged.

- [ ] **Step 15: Commit**

```bash
git add lib/rubros/seed.ts lib/rubros/cambio.ts __tests__/lib/rubros-cambio.test.ts
git commit -m "feat(rubros): replace tipos and vocabulary on a rubro change"
```

---

### Task 2: Checklist replacement

**Files:**
- Modify: `lib/rubros/seed.ts`, the `async function sembrarChecklists(` line (line 164 before Task 1, a few lines lower after it)
- Modify: `lib/rubros/cambio.ts` (`aplicarCambioDeRubro` body, new `reemplazarChecklists`)
- Test: `__tests__/lib/rubros-cambio.test.ts`

**Interfaces:**
- Consumes:
  - Task 1's private `reemplazarTipos`, which returns `Map<string, string>` (codigo → id)
  - Task 1's `actualizarActivo(client, "checklist_templates", organizationId, ids, activo)`
  - `personalizarPack`, `getRubro`
- Produces:
  - `export async function sembrarChecklists(organizationId: string, pack: RubroPack, tipoIdPorCodigo: Map<string, string>, client: typeof supabaseAdmin, errors: string[]): Promise<number>` in `seed.ts`. The signature is unchanged; only `export` is added.
  - `aplicarCambioDeRubro` now also reuses or inserts the new pack's templates and retires the previous pack's.

- [ ] **Step 1: Write the retire-and-seed tests**

Add helpers below `org` in the test file:

```ts
const plantillas = (fake: FakeDb, nombre: string) =>
  (fake.tables.checklist_templates ?? []).filter((t) => t.nombre === nombre)

const nombresChecklist = (rubro: string) => getRubro(rubro).checklists.map((c) => c.nombre)
```

Append a new block:

```ts
describe("aplicarCambioDeRubro: checklists", () => {
  it("retires the previous pack's checklists and seeds the new pack's", async () => {
    const fake = await orgSembradaCon("electrodomesticos")

    await cambiar(fake, sel("electrodomesticos"), sel("electronica"))

    expect(plantillas(fake, "Recepción de artefacto").map((p) => p.activo)).toEqual([false])
    for (const nombre of nombresChecklist("electronica")) {
      expect(plantillas(fake, nombre).map((p) => p.activo)).toEqual([true])
    }
  })

  it("moves the genérico checklist to the new trade's tipo", async () => {
    const fake = await orgSembradaCon("generico", "maquinas de cafe")

    await cambiar(fake, sel("generico", "maquinas de cafe"), sel("generico", "cerraduras"))

    const idDe = (codigo: string) =>
      fake.tables.tipos_dispositivo.find((t) => t.codigo === codigo)?.id
    const recepcion = plantillas(fake, "Recepción")
    expect(recepcion).toHaveLength(2)
    expect(recepcion.find((p) => p.tipo_dispositivo_id === idDe("MAQUINA_DE_CAFE"))?.activo).toBe(false)
    expect(recepcion.find((p) => p.tipo_dispositivo_id === idDe("CERRADURA"))?.activo).toBe(true)
  })

  it("finishes the change when a checklist's items fail to insert", async () => {
    const fake = await orgSembradaCon("electrodomesticos")
    fake.failures["checklist_template_items.insert"] = "items boom"

    await cambiar(fake, sel("electrodomesticos"), sel("electronica"))

    expect(org(fake).rubro).toBe("electronica")
    expect(console.error).toHaveBeenCalledWith(
      "Rubro change: checklist seed errors:",
      expect.arrayContaining([expect.stringContaining("items boom")])
    )
  })

  it("stops before writing the rubro when the checklists cannot be read", async () => {
    const fake = await orgSembradaCon("electrodomesticos")
    fake.failures["checklist_templates.select"] = "read boom"

    await expect(
      cambiar(fake, sel("electrodomesticos"), sel("electronica"))
    ).rejects.toThrow("read boom")

    expect(org(fake)).toMatchObject({
      rubro: "electrodomesticos",
      terminologia: { equipo: "Artefacto" },
    })
  })

  // Guard: passes before the implementation; the retire step must not break it.
  it("leaves the checklists the shop created by hand alone", async () => {
    const fake = await orgSembradaCon("electrodomesticos")
    fake.tables.checklist_templates.push({
      id: "tpl-propio",
      organization_id: ORG,
      nombre: "Mi checklist",
      tipo_dispositivo_id: null,
      activo: true,
    })

    await cambiar(fake, sel("electrodomesticos"), sel("electronica"))

    expect(fake.tables.checklist_templates.find((p) => p.id === "tpl-propio")?.activo).toBe(true)
  })

  // Guard: deleting would break inventory FKs and quote checklist snapshots.
  it("never deletes tipos or checklists", async () => {
    const fake = await orgSembradaCon("electrodomesticos")

    await cambiar(fake, sel("electrodomesticos"), sel("electronica"))
    await cambiar(fake, sel("electronica"), sel("generico", "cerraduras"))

    expect(fake.calls.filter((c) => c.op === "delete")).toEqual([])
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run __tests__/lib/rubros-cambio.test.ts -t "checklists"`
Expected: FAIL for the first four tests, and PASS for the two guards.
- "retires": "Recepción de artefacto" is still `[true]`, and the electrónica templates are `[]`.
- "moves": `recepcion` has length 1.
- "finishes": `console.error` was not called.
- "stops": the promise resolved instead of rejecting.

- [ ] **Step 3: Export `sembrarChecklists`**

In `lib/rubros/seed.ts`, change the line `async function sembrarChecklists(` to:

```ts
/** Also used by the rubro change (lib/rubros/cambio.ts) for the templates it lacks. */
export async function sembrarChecklists(
```

- [ ] **Step 4: Write the first version of `reemplazarChecklists`**

In `lib/rubros/cambio.ts`:

Change the import lines to:

```ts
import { filasDeTipos, sembrarChecklists } from "./seed"
import type { RubroChecklist, RubroPack } from "./types"
```

Add below `interface TipoExistente`:

```ts
interface PlantillaExistente {
  id: string
  nombre: string
  tipo_dispositivo_id: string | null
  activo: boolean | null
}
```

Replace the first three statements of `aplicarCambioDeRubro`, from `const packNuevo` through `await reemplazarTipos(...)`, with:

```ts
  // Resolved before any write: the previous pack comes from what the org
  // still has stored, which is only overwritten by the final UPDATE below.
  const packAnterior = personalizarPack(getRubro(anterior.rubro), anterior.rubroDetalle)
  const packNuevo = personalizarPack(getRubro(nuevo.rubro), nuevo.rubroDetalle)

  const tipoIdPorCodigo = await reemplazarTipos(organizationId, packNuevo, client)
  await reemplazarChecklists(organizationId, packAnterior, packNuevo, tipoIdPorCodigo, client)
```

Add this function below `reemplazarTipos`:

```ts
async function reemplazarChecklists(
  organizationId: string,
  packAnterior: RubroPack,
  packNuevo: RubroPack,
  tipoIdPorCodigo: Map<string, string>,
  client: typeof supabaseAdmin
): Promise<void> {
  // Read BEFORE inserting, so what this change seeds never lands in the retire list.
  const { data, error } = await client
    .from("checklist_templates")
    .select("id, nombre, tipo_dispositivo_id, activo")
    .eq("organization_id", organizationId)
  if (error) throw new Error(`checklist_templates (lectura): ${error.message}`)

  const existentes = (data ?? []) as PlantillaExistente[]

  // Item errors do not abort, as at signup: a missing checklist is fixed from
  // Configuración, a half-applied rubro change is not.
  const errores: string[] = []
  await sembrarChecklists(organizationId, packNuevo, tipoIdPorCodigo, client, errores)
  if (errores.length > 0) console.error("Rubro change: checklist seed errors:", errores)

  const nombresAnteriores = new Set(packAnterior.checklists.map((c) => c.nombre))
  const aRetirar = existentes
    .filter((p) => nombresAnteriores.has(p.nombre) && p.activo !== false)
    .map((p) => p.id)
  await actualizarActivo(client, "checklist_templates", organizationId, aRetirar, false)
}
```

At this step `RubroChecklist` is imported but unused. Step 8 uses it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run __tests__/lib/rubros-cambio.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 6: Write the reuse tests**

Append to the `describe("aplicarCambioDeRubro: checklists")` block:

```ts
  it("does not duplicate a checklist when the shop comes back to a rubro", async () => {
    const fake = await orgSembradaCon("electrodomesticos")

    await cambiar(fake, sel("electrodomesticos"), sel("electronica"))
    await cambiar(fake, sel("electronica"), sel("electrodomesticos"))

    expect(plantillas(fake, "Recepción de artefacto").map((p) => p.activo)).toEqual([true])
    for (const nombre of nombresChecklist("electronica")) {
      expect(plantillas(fake, nombre).map((p) => p.activo)).toEqual([false])
    }
    expect(console.error).not.toHaveBeenCalled()
  })

  it("brings back a typed checklist instead of failing on its unique key", async () => {
    const fake = await orgSembradaCon("electronica")

    await cambiar(fake, sel("electronica"), sel("electrodomesticos"))
    await cambiar(fake, sel("electrodomesticos"), sel("electronica"))

    for (const nombre of nombresChecklist("electronica")) {
      expect(plantillas(fake, nombre).map((p) => p.activo)).toEqual([true])
    }
    expect(plantillas(fake, "Recepción de artefacto").map((p) => p.activo)).toEqual([false])
    expect(console.error).not.toHaveBeenCalled()
  })

  it("keeps the checklist when the new pack has it for the same tipo", async () => {
    const fake = await orgSembradaCon("generico", "maquinas de cafe")

    await cambiar(fake, sel("generico", "maquinas de cafe"), sel("generico", "máquinas de café"))

    expect(plantillas(fake, "Recepción").map((p) => p.activo)).toEqual([true])
    expect(console.error).not.toHaveBeenCalled()
  })
```

- [ ] **Step 7: Run them to verify they fail**

Run: `npx vitest run __tests__/lib/rubros-cambio.test.ts -t "duplicate|brings back|same tipo"`
Expected: FAIL. These are the seed gaps the spec names.
- "duplicate": "Recepción de artefacto" is `[false, true]`. The untyped template is inserted twice, because NULL tipo ids never collide.
- "brings back": the electrónica templates are `[false]`. The re-insert hits 23505, and `console.error` was called.
- "same tipo": "Recepción" is `[false]`. The insert hit 23505, then the old row was retired.

- [ ] **Step 8: Reuse existing templates before inserting**

In `lib/rubros/cambio.ts`, replace the body of `reemplazarChecklists`, from the line after the `existentes` declaration to the end of the function, with:

```ts
  // UNIQUE (organization_id, nombre, tipo_dispositivo_id), migration 050.
  // Re-inserting duplicates the untyped templates (NULLs never collide) and
  // fails with 23505 on the typed ones, so an existing match is reused instead.
  const clave = (nombre: string, tipoId: string | null) => JSON.stringify([nombre, tipoId])
  const porClave = new Map(
    existentes.map((p) => [clave(p.nombre, p.tipo_dispositivo_id ?? null), p])
  )

  const conservadas = new Set<string>()
  const faltantes: RubroChecklist[] = []
  for (const checklist of packNuevo.checklists) {
    const tipoId =
      checklist.tipoCodigo === null ? null : tipoIdPorCodigo.get(checklist.tipoCodigo)
    const existente = tipoId === undefined ? undefined : porClave.get(clave(checklist.nombre, tipoId))
    if (existente) conservadas.add(existente.id)
    else faltantes.push(checklist)
  }

  const aReactivar = existentes
    .filter((p) => conservadas.has(p.id) && p.activo === false)
    .map((p) => p.id)
  await actualizarActivo(client, "checklist_templates", organizationId, aReactivar, true)

  // Item errors do not abort, as at signup: a missing checklist is fixed from
  // Configuración, a half-applied rubro change is not.
  const errores: string[] = []
  await sembrarChecklists(
    organizationId,
    { ...packNuevo, checklists: faltantes },
    tipoIdPorCodigo,
    client,
    errores
  )
  if (errores.length > 0) console.error("Rubro change: checklist seed errors:", errores)

  const nombresAnteriores = new Set(packAnterior.checklists.map((c) => c.nombre))
  const aRetirar = existentes
    .filter((p) => nombresAnteriores.has(p.nombre) && !conservadas.has(p.id) && p.activo !== false)
    .map((p) => p.id)
  await actualizarActivo(client, "checklist_templates", organizationId, aRetirar, false)
```

- [ ] **Step 9: Run the new suite and the signup suites**

Run: `npx vitest run __tests__/lib/rubros-cambio.test.ts __tests__/lib/rubros-seed.test.ts __tests__/api/register-rubro.test.ts`
Expected: PASS. `rubros-cambio` has 17 tests, and the signup suites are unchanged.

- [ ] **Step 10: Commit**

```bash
git add lib/rubros/seed.ts lib/rubros/cambio.ts __tests__/lib/rubros-cambio.test.ts
git commit -m "feat(rubros): reuse and retire checklists on a rubro change"
```

---

### Task 3: `PUT /api/onboarding/rubro`

**Files:**
- Modify: `lib/rubros/cambio.ts` (add `mismoRubro`, import `DEFAULT_RUBRO_ID`)
- Create: `app/api/onboarding/rubro/route.ts`
- Test: `__tests__/lib/rubros-cambio.test.ts` (the `mismoRubro` block)
- Test: `__tests__/api/onboarding-rubro.test.ts`

**Interfaces:**
- Consumes:
  - `deletePracticeData(organizationId: string, client = supabaseAdmin): Promise<{ ordenBorrada: boolean; clienteConservado: boolean }>` from `lib/onboarding/practica.ts` (PR 1). It throws on a DB error.
  - The `ordenes_servicio.es_practica` column (PR 1)
  - `requireAdmin()` from `lib/auth-utils.ts:55`
  - `validarSeleccionRubro(rubro, detalle): string | null` from `lib/rubros/seleccion.ts:13`
  - `DEFAULT_RUBRO_ID` from `lib/rubros/index.ts:29`
  - `aplicarCambioDeRubro` and `contarTiposActivos` (Task 1)
- Produces:
  - `export function mismoRubro(actual: SeleccionRubro, pedido: SeleccionRubro): boolean`
  - `PUT /api/onboarding/rubro`, with the contract in the final Interfaces block. PR 3 consumes it and should `router.refresh()` after a 200, so the server-fed wizard reloads tipos and terminology.

- [ ] **Step 0: Confirm PR 1 is on the branch**

Run: `rg -n "export async function deletePracticeData" lib/onboarding/practica.ts`
Expected: one match. If the file is missing, stop: PR 1 is not merged into this branch.

- [ ] **Step 1: Write the `mismoRubro` tests**

In `__tests__/lib/rubros-cambio.test.ts`, change the cambio import to:

```ts
import { aplicarCambioDeRubro, mismoRubro, type SeleccionRubro } from "@/lib/rubros/cambio"
```

Append:

```ts
describe("mismoRubro", () => {
  it.each<{ caso: string; actual: SeleccionRubro; pedido: SeleccionRubro; esperado: boolean }>([
    {
      caso: "same curated pack",
      actual: sel("automotor"),
      pedido: sel("automotor"),
      esperado: true,
    },
    {
      caso: "same curated pack ignores a stale trade text",
      actual: sel("automotor", "algo viejo"),
      pedido: sel("automotor"),
      esperado: true,
    },
    {
      caso: "different pack",
      actual: sel("automotor"),
      pedido: sel("electronica"),
      esperado: false,
    },
    {
      caso: "same genérico trade modulo spaces",
      actual: sel("generico", "maquinas de cafe "),
      pedido: sel("generico", "maquinas de cafe"),
      esperado: true,
    },
    {
      caso: "different genérico trade",
      actual: sel("generico", "maquinas de cafe"),
      pedido: sel("generico", "cerraduras"),
      esperado: false,
    },
    {
      caso: "org without a stored rubro",
      actual: { rubro: null, rubroDetalle: null },
      pedido: sel("generico", "cerraduras"),
      esperado: false,
    },
  ])("$caso", ({ actual, pedido, esperado }) => {
    expect(mismoRubro(actual, pedido)).toBe(esperado)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run __tests__/lib/rubros-cambio.test.ts -t "mismoRubro"`
Expected: FAIL with `TypeError: mismoRubro is not a function`.

- [ ] **Step 3: Implement `mismoRubro`**

In `lib/rubros/cambio.ts`, change `import { getRubro } from "./index"` to:

```ts
import { getRubro, DEFAULT_RUBRO_ID } from "./index"
```

Add below `interface PlantillaExistente`:

```ts
/**
 * True when the request would rebuild what the org already has. A curated pack
 * ignores the trade text (personalizarPack only reads it for genérico).
 */
export function mismoRubro(actual: SeleccionRubro, pedido: SeleccionRubro): boolean {
  if (actual.rubro !== pedido.rubro) return false
  if (pedido.rubro !== DEFAULT_RUBRO_ID) return true
  return (actual.rubroDetalle ?? "").trim() === (pedido.rubroDetalle ?? "").trim()
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/lib/rubros-cambio.test.ts`
Expected: PASS, 23 tests.

- [ ] **Step 5: Write the route tests for auth, validation and the change path**

Create `__tests__/api/onboarding-rubro.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  mockSupabaseFrom,
  createChainMock,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/onboarding/practica", () => ({
  deletePracticeData: vi.fn(),
}))

// mismoRubro stays real: the route's no-op decision is part of what is tested.
vi.mock("@/lib/rubros/cambio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rubros/cambio")>()),
  aplicarCambioDeRubro: vi.fn(),
  contarTiposActivos: vi.fn(),
}))

import { deletePracticeData } from "@/lib/onboarding/practica"
import { aplicarCambioDeRubro, contarTiposActivos } from "@/lib/rubros/cambio"
import { PUT } from "@/app/api/onboarding/rubro/route"

const enviar = (cuerpo: string) =>
  PUT(
    new Request("http://localhost:3000/api/onboarding/rubro", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: cuerpo,
    })
  )

const put = (body: unknown) => enviar(JSON.stringify(body))

const ERROR_INTERNO = "No pudimos cambiar el rubro. Probá de nuevo."

function mockOrg(
  org: { rubro: string | null; rubro_detalle: string | null } = {
    rubro: "electrodomesticos",
    rubro_detalle: null,
  },
  ordenesReales = 0
) {
  const organizations = createChainMock(org)
  const ordenes = createChainMock(null, null, ordenesReales)
  mockSupabaseFrom({ organizations, ordenes_servicio: ordenes })
  return { organizations, ordenes }
}

vi.spyOn(console, "error").mockImplementation(() => {})

describe("PUT /api/onboarding/rubro", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
    mockOrg()
    vi.mocked(deletePracticeData).mockResolvedValue({ ordenBorrada: true, clienteConservado: false })
    vi.mocked(aplicarCambioDeRubro).mockResolvedValue({ tiposActivos: 7 })
    vi.mocked(contarTiposActivos).mockResolvedValue(4)
  })

  it("rejects a request without a session", async () => {
    mockAuthError()

    const { status } = await parseResponse(await put({ rubro: "electronica" }))

    expect(status).toBe(401)
    expect(aplicarCambioDeRubro).not.toHaveBeenCalled()
  })

  it.each(["TECNICO", "VENDEDOR"])("rejects a %s: only an admin changes the rubro", async (role) => {
    mockAuthSuccess({ role })

    const { status } = await parseResponse(await put({ rubro: "electronica" }))

    expect(status).toBe(403)
    expect(deletePracticeData).not.toHaveBeenCalled()
    expect(aplicarCambioDeRubro).not.toHaveBeenCalled()
  })

  it("rejects a body that is not JSON", async () => {
    const { status, body } = await parseResponse(await enviar("{no es json"))

    expect(status).toBe(400)
    expect(body.error).toBe("Datos inválidos")
  })

  it.each<{ caso: string; body: unknown; mensaje: string }>([
    { caso: "unknown rubro id", body: { rubro: "plomeria" }, mensaje: "Elegí qué reparás" },
    { caso: "rubro is not a string", body: { rubro: 3 }, mensaje: "Elegí qué reparás" },
    { caso: "missing rubro", body: {}, mensaje: "Elegí qué reparás" },
    { caso: "body is an array", body: [], mensaje: "Datos inválidos" },
    {
      caso: "genérico without trade",
      body: { rubro: "generico" },
      mensaje: "Contanos qué reparás para preparar tu cuenta",
    },
    {
      caso: "genérico with a blank trade",
      body: { rubro: "generico", rubroDetalle: "   " },
      mensaje: "Contanos qué reparás para preparar tu cuenta",
    },
    {
      caso: "genérico with an unusable trade",
      body: { rubro: "generico", rubroDetalle: "###" },
      mensaje: "Escribí qué reparás con palabras, por ejemplo: máquinas de café",
    },
    {
      caso: "trade longer than the signup limit",
      body: { rubro: "generico", rubroDetalle: "x".repeat(121) },
      mensaje: "Contanos qué reparás en menos de 120 caracteres",
    },
  ])("answers 400 and changes nothing: $caso", async ({ body: payload, mensaje }) => {
    const { status, body } = await parseResponse(await put(payload))

    expect(status).toBe(400)
    expect(body.error).toBe(mensaje)
    expect(deletePracticeData).not.toHaveBeenCalled()
    expect(aplicarCambioDeRubro).not.toHaveBeenCalled()
  })

  it("deletes the practice, then applies the change, and answers with the new rubro", async () => {
    const { status, body } = await parseResponse(await put({ rubro: "electronica" }))

    expect(status).toBe(200)
    expect(body).toEqual({ rubro: "electronica", rubroDetalle: null, tiposActivos: 7 })
    expect(deletePracticeData).toHaveBeenCalledWith("org-1")
    expect(aplicarCambioDeRubro).toHaveBeenCalledWith(
      "org-1",
      { rubro: "electrodomesticos", rubroDetalle: null },
      { rubro: "electronica", rubroDetalle: null }
    )
    const borrado = vi.mocked(deletePracticeData).mock.invocationCallOrder[0]
    const cambio = vi.mocked(aplicarCambioDeRubro).mock.invocationCallOrder[0]
    expect(borrado).toBeLessThan(cambio)
  })

  it("passes the genérico trade trimmed and returns it", async () => {
    const { body } = await parseResponse(
      await put({ rubro: "generico", rubroDetalle: "  maquinas de cafe  " })
    )

    expect(aplicarCambioDeRubro).toHaveBeenCalledWith("org-1", expect.anything(), {
      rubro: "generico",
      rubroDetalle: "maquinas de cafe",
    })
    expect(body.rubroDetalle).toBe("maquinas de cafe")
  })

  it("drops a stray trade text when the rubro is a curated pack", async () => {
    await put({ rubro: "automotor", rubroDetalle: "maquinas de cafe" })

    expect(aplicarCambioDeRubro).toHaveBeenCalledWith("org-1", expect.anything(), {
      rubro: "automotor",
      rubroDetalle: null,
    })
  })

  it("answers 500 and does not seed when the practice cannot be deleted", async () => {
    vi.mocked(deletePracticeData).mockRejectedValue(new Error("practice boom"))

    const { status, body } = await parseResponse(await put({ rubro: "electronica" }))

    expect(status).toBe(500)
    expect(body.error).toBe(ERROR_INTERNO)
    expect(aplicarCambioDeRubro).not.toHaveBeenCalled()
  })

  it("answers 500 when the change itself fails", async () => {
    vi.mocked(aplicarCambioDeRubro).mockRejectedValue(new Error("tipos_dispositivo: boom"))

    const { status, body } = await parseResponse(await put({ rubro: "electronica" }))

    expect(status).toBe(500)
    expect(body.error).toBe(ERROR_INTERNO)
  })

  it("answers 500 and changes nothing when the org cannot be read", async () => {
    mockSupabaseFrom({
      organizations: createChainMock(null, { message: "org boom" }),
      ordenes_servicio: createChainMock(null, null, 0),
    })

    const { status } = await parseResponse(await put({ rubro: "electronica" }))

    expect(status).toBe(500)
    expect(deletePracticeData).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run __tests__/api/onboarding-rubro.test.ts`
Expected: FAIL. The suite cannot load: `Failed to resolve import "@/app/api/onboarding/rubro/route"`.

- [ ] **Step 7: Create the route**

Create `app/api/onboarding/rubro/route.ts`:

```ts
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { DEFAULT_RUBRO_ID } from "@/lib/rubros"
import { validarSeleccionRubro } from "@/lib/rubros/seleccion"
import {
  aplicarCambioDeRubro,
  contarTiposActivos,
  mismoRubro,
  type SeleccionRubro,
} from "@/lib/rubros/cambio"
import { deletePracticeData } from "@/lib/onboarding/practica"

/** Same limit as the signup (app/api/auth/register/route.ts:32). */
const MAX_DETALLE = 120

const bodySchema = z.object(
  {
    rubro: z.string({
      required_error: "Elegí qué reparás",
      invalid_type_error: "Elegí qué reparás",
    }),
    rubroDetalle: z
      .string({ invalid_type_error: "Datos inválidos" })
      .max(MAX_DETALLE, `Contanos qué reparás en menos de ${MAX_DETALLE} caracteres`)
      .nullable()
      .optional(),
  },
  { required_error: "Datos inválidos", invalid_type_error: "Datos inválidos" }
)

const ERROR_INTERNO = "No pudimos cambiar el rubro. Probá de nuevo."

/**
 * Changes the rubro from the onboarding wizard while the shop has no real
 * orders. The spec's order: delete the practice, then aplicarCambioDeRubro
 * (tipos, checklists, vocabulary, rubro). See lib/rubros/cambio.ts.
 */
export async function PUT(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error
    const orgId = organizationId!

    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
    }

    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message ?? "Datos inválidos" },
        { status: 400 }
      )
    }

    const rubro = parsed.data.rubro.trim()
    const detalle = parsed.data.rubroDetalle?.trim() ?? ""

    // The signup form's own rule (app/(auth)/registro/page.tsx:173): a known
    // id, and genérico needs a trade we can derive a tipo from.
    const errorSeleccion = validarSeleccionRubro(rubro, detalle)
    if (errorSeleccion) {
      return NextResponse.json({ error: errorSeleccion }, { status: 400 })
    }

    // Migration 308: rubro_detalle is NULL for a curated pack.
    const pedido: SeleccionRubro = {
      rubro,
      rubroDetalle: rubro === DEFAULT_RUBRO_ID ? detalle : null,
    }

    const { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .select("rubro, rubro_detalle")
      .eq("id", orgId)
      .single()
    if (orgError || !org) {
      throw new Error(`organizations: ${orgError?.message ?? "not found"}`)
    }

    const anterior: SeleccionRubro = {
      rubro: org.rubro ?? null,
      rubroDetalle: org.rubro_detalle ?? null,
    }

    await deletePracticeData(orgId)
    const { tiposActivos } = await aplicarCambioDeRubro(orgId, anterior, pedido)

    return NextResponse.json({ ...pedido, tiposActivos })
  } catch (err) {
    console.error("Error changing rubro:", err)
    return NextResponse.json({ error: ERROR_INTERNO }, { status: 500 })
  }
}
```

`contarTiposActivos` and `mismoRubro` are imported but unused until Step 15.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run __tests__/api/onboarding-rubro.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 9: Write the real-order guard tests**

Append inside the `describe("PUT /api/onboarding/rubro")` block:

```ts
  it("answers 409 and touches nothing when the shop has a real order", async () => {
    mockOrg(undefined, 1)

    const { status, body } = await parseResponse(await put({ rubro: "electronica" }))

    expect(status).toBe(409)
    expect(body.error).toBe("Ya tenés órdenes cargadas: el rubro no se puede cambiar desde acá.")
    expect(deletePracticeData).not.toHaveBeenCalled()
    expect(aplicarCambioDeRubro).not.toHaveBeenCalled()
  })

  it("counts only the org's real orders, not the practice", async () => {
    const { ordenes } = mockOrg()

    await put({ rubro: "electronica" })

    expect(ordenes.select).toHaveBeenCalledWith("id", { count: "exact", head: true })
    expect(ordenes.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(ordenes.eq).toHaveBeenCalledWith("es_practica", false)
  })

  it("fails closed when the real-order count errors", async () => {
    mockSupabaseFrom({
      organizations: createChainMock({ rubro: "electrodomesticos", rubro_detalle: null }),
      ordenes_servicio: createChainMock(null, { message: "count boom" }),
    })

    const { status } = await parseResponse(await put({ rubro: "electronica" }))

    expect(status).toBe(500)
    expect(deletePracticeData).not.toHaveBeenCalled()
    expect(aplicarCambioDeRubro).not.toHaveBeenCalled()
  })
```

- [ ] **Step 10: Run them to verify they fail**

Run: `npx vitest run __tests__/api/onboarding-rubro.test.ts -t "409|real orders|fails closed"`
Expected: FAIL.
- "409": status is 200.
- "counts": `ordenes.select` was never called.
- "fails closed": status is 200, and `deletePracticeData` was called.

- [ ] **Step 11: Add the real-order guard**

In `app/api/onboarding/rubro/route.ts`, add below the `ERROR_INTERNO` constant:

```ts
const ERROR_CON_ORDENES = "Ya tenés órdenes cargadas: el rubro no se puede cambiar desde acá."
```

Insert right after the `if (orgError || !org) { ... }` block, before `const anterior`:

```ts
    const { count, error: countError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("es_practica", false)
    // Fail closed: an unknown count must never read as "no real orders".
    if (countError || typeof count !== "number") {
      throw new Error(`ordenes_servicio: ${countError?.message ?? "count missing"}`)
    }
    if (count > 0) {
      return NextResponse.json({ error: ERROR_CON_ORDENES }, { status: 409 })
    }
```

- [ ] **Step 12: Run the tests to verify they pass**

Run: `npx vitest run __tests__/api/onboarding-rubro.test.ts`
Expected: PASS, 21 tests.

- [ ] **Step 13: Write the same-rubro tests**

Append inside the same `describe` block:

```ts
  it("answers 200 without touching anything when the rubro does not change", async () => {
    mockOrg({ rubro: "electrodomesticos", rubro_detalle: null })

    const { status, body } = await parseResponse(await put({ rubro: "electrodomesticos" }))

    expect(status).toBe(200)
    expect(body).toEqual({ rubro: "electrodomesticos", rubroDetalle: null, tiposActivos: 4 })
    expect(deletePracticeData).not.toHaveBeenCalled()
    expect(aplicarCambioDeRubro).not.toHaveBeenCalled()
    expect(contarTiposActivos).toHaveBeenCalledWith("org-1")
  })

  it("treats the same genérico trade, modulo spaces, as no change", async () => {
    mockOrg({ rubro: "generico", rubro_detalle: "maquinas de cafe" })

    await put({ rubro: "generico", rubroDetalle: " maquinas de cafe " })

    expect(deletePracticeData).not.toHaveBeenCalled()
    expect(aplicarCambioDeRubro).not.toHaveBeenCalled()
  })

  // Guard: the 409 runs before the no-op check.
  it("still answers 409 for the same rubro when the shop has real orders", async () => {
    mockOrg({ rubro: "electrodomesticos", rubro_detalle: null }, 2)

    const { status } = await parseResponse(await put({ rubro: "electrodomesticos" }))

    expect(status).toBe(409)
    expect(contarTiposActivos).not.toHaveBeenCalled()
  })
```

- [ ] **Step 14: Run them to verify they fail**

Run: `npx vitest run __tests__/api/onboarding-rubro.test.ts -t "does not change|modulo spaces|same rubro"`
Expected: FAIL for the first two, and PASS for the guard. In the first two, `deletePracticeData` and `aplicarCambioDeRubro` were called. In the first, `tiposActivos` is 7, not 4.

- [ ] **Step 15: Add the no-op branch**

In `app/api/onboarding/rubro/route.ts`, insert right after the `const anterior: SeleccionRubro = { ... }` declaration:

```ts
    // Re-picking the current rubro writes nothing: it keeps the practice and
    // any vocabulary the shop edited by hand.
    if (mismoRubro(anterior, pedido)) {
      const tiposActivos = await contarTiposActivos(orgId)
      return NextResponse.json({ ...pedido, tiposActivos })
    }
```

- [ ] **Step 16: Run every suite this PR touches or depends on**

Run: `npx vitest run __tests__/api/onboarding-rubro.test.ts __tests__/lib/rubros-cambio.test.ts __tests__/lib/rubros-seed.test.ts __tests__/api/register-rubro.test.ts`
Expected: PASS. `onboarding-rubro` has 24 tests and `rubros-cambio` has 23. The signup suites are unchanged.

- [ ] **Step 17: Type-check, lint and confirm the server-only boundary**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint lib/rubros app/api/onboarding/rubro __tests__/lib/rubros-cambio.test.ts __tests__/api/onboarding-rubro.test.ts`
Expected: no errors.

Run: `rg -n "rubros/cambio" app components hooks lib`
Expected: one match only, `app/api/onboarding/rubro/route.ts`. Test files are outside these paths.

- [ ] **Step 18: Full suite and scope check**

Run: `npx vitest run`
Expected: PASS, with no new failures compared with `main`.

Run: `git diff --stat origin/main`
Expected: exactly these 5 files.
- `lib/rubros/seed.ts`
- `lib/rubros/cambio.ts`
- `app/api/onboarding/rubro/route.ts`
- `__tests__/lib/rubros-cambio.test.ts`
- `__tests__/api/onboarding-rubro.test.ts`

- [ ] **Step 19: Commit**

```bash
git add lib/rubros/cambio.ts app/api/onboarding/rubro/route.ts __tests__/lib/rubros-cambio.test.ts __tests__/api/onboarding-rubro.test.ts
git commit -m "feat(onboarding): add PUT /api/onboarding/rubro"
```

---

## Final Interfaces

```
lib/rubros/seed.ts            (server-only; signup behavior unchanged)
  export function filasDeTipos(organizationId: string, pack: RubroPack)
    -> rows { organization_id, codigo, nombre, prefijo_orden, icono, activo: true, es_base: true, orden, config }
  export async function sembrarChecklists(organizationId: string, pack: RubroPack,
    tipoIdPorCodigo: Map<string, string>, client: typeof supabaseAdmin, errors: string[]): Promise<number>
  seedOrganizationFromRubro(...)   unchanged

lib/rubros/cambio.ts          (server-only, never import from client code)
  export interface SeleccionRubro { rubro: string | null; rubroDetalle: string | null }
  export function mismoRubro(actual: SeleccionRubro, pedido: SeleccionRubro): boolean
  export async function contarTiposActivos(organizationId: string, client?: typeof supabaseAdmin): Promise<number>
    // activo = true, without TODOS
  export async function aplicarCambioDeRubro(organizationId: string, anterior: SeleccionRubro,
    nuevo: SeleccionRubro, client?: typeof supabaseAdmin): Promise<{ tiposActivos: number }>
    // throws on any DB error; a failed tipos upsert throws before any other write;
    // never deletes; writes terminologia + rubro + rubro_detalle last, in one UPDATE

PUT /api/onboarding/rubro     (app/api/onboarding/rubro/route.ts)
  requireAdmin: 401 "No autorizado" / 403 "Acceso denegado"
  body { rubro: string; rubroDetalle?: string | null }
  200 { rubro: string; rubroDetalle: string | null; tiposActivos: number }
      rubroDetalle is trimmed for genérico, null for a curated pack
      same rubro (and same trimmed trade for genérico): 200, no writes, practice kept
  400 { error } "Datos inválidos" | "Elegí qué reparás"
      | "Contanos qué reparás para preparar tu cuenta"
      | "Escribí qué reparás con palabras, por ejemplo: máquinas de café"
      | "Contanos qué reparás en menos de 120 caracteres"
  409 { error: "Ya tenés órdenes cargadas: el rubro no se puede cambiar desde acá." }
      when the org has ANY ordenes_servicio row with es_practica = false (checked before the no-op)
  500 { error: "No pudimos cambiar el rubro. Probá de nuevo." }
      DB error, practice deletion failure, or failed real-order count (fails closed)

Consumed from PR 1:
  lib/onboarding/practica.ts  deletePracticeData(organizationId: string, client = supabaseAdmin)
                              : Promise<{ ordenBorrada: boolean; clienteConservado: boolean }>  // throws on DB error
  DB: ordenes_servicio.es_practica boolean NOT NULL DEFAULT false
```

## Self-review against the spec

| Spec requirement | Where |
|---|---|
| `requireAdmin` | Task 3 Step 5: 401 and 403 tests |
| 409 when any order has `es_practica = false` | Task 3 Steps 9-11 |
| Step 1: `deletePracticeData` first | Task 3 Step 5, call-order assertion |
| Step 2: seed tipos and checklists; abort with nothing changed if tipos fail | Task 1 Step 1 (abort test); Task 2 |
| Step 3: deactivate base tipos not in the new pack; set the new pack's codes active | Task 1 Steps 1 and 7 |
| Step 4: retire the previous pack's checklists by name, with the previous pack resolved before the update | Task 2 Steps 1-8; Decision 5 |
| Step 5: terminology including `{}` | Task 1 Step 11 |
| Step 6: `rubro` and `rubro_detalle` | Task 1 Step 11; Task 3 normalization tests |
| Signup unchanged | Global Constraints; Task 1 Step 4; Tasks 1-3 rerun the signup suites |
| Test: three seed gaps | Task 1 Step 1 (old tipos), Task 1 Step 11 (`{}`), Task 2 Step 6 (duplicates) |
| Test: genérico with `rubroDetalle` | Task 1 Step 11; Task 2 Step 1; Task 3 Step 5 |
| Test: non-admin rejected | Task 3 Step 5 |
| Test: abort when tipos seeding fails | Task 1 Step 1 |
| Error table: "Rubro change fails during seeding: nothing changed" | Task 1 abort test (`tables` deep-equal) |
