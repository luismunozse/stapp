# Revision of an accepted cotización — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a shop correct an already-signed cotización by issuing a revision that supersedes it, without ever mutating the signed row.

**Architecture:** A revision is a new `cotizaciones` row. The accepted row stays frozen with its signature and items, and gains a `reemplazada_por` pointer to the revision. Because a revision sits in `ENVIADA`, the existing send/sign path and `aprobar_cotizacion_atomica` accept it with no changes. Superseded rows are excluded from the orden's budget through one shared query, extracted first so the exclusion is added in one place rather than six.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (Postgres + plpgsql RPCs), Vitest + Testing Library, SWR.

**Spec:** `docs/superpowers/specs/2026-08-25-revision-cotizacion-aceptada-design.md`

## Global Constraints

- Migrations are applied by hand; the number is assigned at merge time, not when the branch is created. Never renumber below an already-applied migration. See `scripts/db-run.mjs` (dry-run by default).
- Every migration ships with a matching `supabase/migrations/rollback/<n>_rollback.sql`.
- `npx tsc --noEmit` must exit 0. Lint and tests passing is not sufficient — the type check is part of "done".
- Do not run `npm run lint`; it walks the worktrees and never finishes. Use `npx eslint <dirs>`.
- Conventional commits. Never add `Co-Authored-By` or AI attribution.
- Code, comments, identifiers and UI copy in the files touched here follow the surrounding language: comments in this area are Spanish, UI copy is Spanish.
- The server guard at `app/api/cotizaciones/[id]/route.ts:316` (no item edits on `ACEPTADA`/`RECHAZADA`) is never relaxed. Revising creates a row; it never mutates the signed one.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/cotizacion-presupuesto.ts` (create) | Single source of "which cotizaciones count for this orden", plus the total built on it. Matches the existing `lib/cotizacion-*.ts` convention. |
| `app/api/cotizaciones/[id]/route.ts` (modify) | Drops 3 inline copies of the query; `recalcPresupuestoOrden` delegates to the module. |
| `app/api/cotizaciones/[id]/enviar/route.ts` (modify) | Drops 1 inline copy. |
| `app/api/cotizaciones/route.ts` (modify) | Drops 1 inline copy. |
| `app/api/cotizaciones/[id]/revisar/route.ts` (create) | POST that clones an `ACEPTADA` into a `BORRADOR` revision. |
| `supabase/migrations/<n>_cotizacion_reemplazada_por.sql` (create) | Adds the nullable pointer + index. |
| `components/cotizaciones/cotizacion-list.tsx` (modify) | "Revisar" action, superseded rendering, pending-revision notice. |

---

# Slice 0 — Consolidate the budget queries (no behavior change)

Six places ask which cotizaciones count for an orden. Five copied the query inline even though `recalcPresupuestoOrden` already exists and is called from exactly one site. Slice 0 changes no behavior; it only removes the duplication, so Slice 1 adds its condition once.

### Task 1: Extract the shared query module

**Files:**
- Create: `lib/cotizacion-presupuesto.ts`
- Test: `__tests__/lib/cotizacion-presupuesto.test.ts`

**Interfaces:**
- Consumes: `supabaseAdmin` from `@/lib/supabase`.
- Produces:
  - `cotizacionesVigentesDeOrden(ordenId: string): Promise<Array<{ total: number }>>`
  - `totalPresupuestoDeOrden(ordenId: string): Promise<{ total: number; cantidad: number }>`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/cotizacion-presupuesto.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockSupabaseFrom } from "../api/helpers"
import { cotizacionesVigentesDeOrden, totalPresupuestoDeOrden } from "@/lib/cotizacion-presupuesto"

describe("cotizacion-presupuesto — cotizaciones vigentes de una orden", () => {
  beforeEach(() => vi.clearAllMocks())

  it("suma los totales de las cotizaciones devueltas", async () => {
    mockSupabaseFrom({
      cotizaciones: createChainMock([{ total: 100 }, { total: 50 }]),
    })
    expect(await totalPresupuestoDeOrden("orden-1")).toEqual({ total: 150, cantidad: 2 })
  })

  it("una orden sin cotizaciones vigentes da total 0 y cantidad 0", async () => {
    mockSupabaseFrom({ cotizaciones: createChainMock([]) })
    expect(await totalPresupuestoDeOrden("orden-1")).toEqual({ total: 0, cantidad: 0 })
  })

  it("trata la respuesta nula como orden sin cotizaciones, no como error", async () => {
    mockSupabaseFrom({ cotizaciones: createChainMock(null) })
    expect(await totalPresupuestoDeOrden("orden-1")).toEqual({ total: 0, cantidad: 0 })
  })

  it("suma totales que llegan como string desde Postgres", async () => {
    mockSupabaseFrom({
      cotizaciones: createChainMock([{ total: "100.50" }, { total: "0.50" }]),
    })
    expect((await totalPresupuestoDeOrden("orden-1")).total).toBe(101)
  })

  it("expone las filas crudas para quien solo necesita contarlas", async () => {
    mockSupabaseFrom({ cotizaciones: createChainMock([{ total: 10 }]) })
    expect(await cotizacionesVigentesDeOrden("orden-1")).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/cotizacion-presupuesto.test.ts`
Expected: FAIL — cannot resolve `@/lib/cotizacion-presupuesto`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/cotizacion-presupuesto.ts
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Única definición de "qué cotizaciones cuentan para una orden".
 *
 * Estaba copiada en seis lugares (la API de cotizaciones, la de enviar y la de
 * alta), y eso hacía que cualquier cambio en el criterio tuviera que acertarle
 * a los seis. Con una sola definición, el criterio se cambia una vez.
 */
export async function cotizacionesVigentesDeOrden(
  ordenId: string
): Promise<Array<{ total: number }>> {
  const { data } = await supabaseAdmin
    .from("cotizaciones")
    .select("total")
    .eq("orden_id", ordenId)
    .is("deleted_at", null)
    .neq("estado", "RECHAZADA")
  return (data || []) as Array<{ total: number }>
}

/** Total presupuestado de una orden y cuántas cotizaciones lo componen. */
export async function totalPresupuestoDeOrden(
  ordenId: string
): Promise<{ total: number; cantidad: number }> {
  const vigentes = await cotizacionesVigentesDeOrden(ordenId)
  const total = vigentes.reduce((sum, c) => sum + Number(c.total), 0)
  return { total, cantidad: vigentes.length }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/cotizacion-presupuesto.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/cotizacion-presupuesto.ts __tests__/lib/cotizacion-presupuesto.test.ts
git commit -m "refactor(cotizaciones): una sola definicion de que cotizaciones cuentan para una orden"
```

---

### Task 2: Route all six call sites through the module

No behavior changes. If any existing test moves, the refactor is wrong — not the test.

**Files:**
- Modify: `app/api/cotizaciones/[id]/route.ts` — the body of `recalcPresupuestoOrden` (starts line 119), and the inline copies at ~636-642, ~750-755, ~793-799
- Modify: `app/api/cotizaciones/[id]/enviar/route.ts:143-149`
- Modify: `app/api/cotizaciones/route.ts:479-485`

**Interfaces:**
- Consumes: `totalPresupuestoDeOrden`, `cotizacionesVigentesDeOrden` from Task 1.
- Produces: nothing new; `recalcPresupuestoOrden` keeps its existing signature `(ordenId: string, organizationId: string, userId?: string | null)`.

- [ ] **Step 1: Capture current behavior as a test**

This is the equivalence guard the whole slice rests on. Add to `__tests__/api/cotizaciones-presupuesto-recalc.test.ts` (create):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

// El presupuesto de la orden es la suma de sus cotizaciones no rechazadas.
// Este test fija ese comportamiento ANTES del refactor: si se mueve, el
// refactor esta mal, no el test.
describe("PUT /api/cotizaciones/[id] — presupuesto de la orden", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("escribe en la orden la suma de las cotizaciones vigentes", async () => {
    const ordenesChain = createChainMock({ id: "orden-1", estado: "PRESUPUESTADO" })
    mockSupabaseFrom({
      cotizaciones: createChainMock([{ total: 100 }, { total: 50 }]),
      ordenes_servicio: ordenesChain,
      items_cotizacion: createChainMock([]),
      orden_eventos: createChainMock(null),
    })

    const { PUT } = await import("@/app/api/cotizaciones/[id]/route")
    await PUT(
      new Request("http://localhost:3000/api/cotizaciones/cot-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ descripcion: "X", cantidad: 1, precioUnitario: 150 }],
        }),
      }) as any,
      { params: Promise.resolve({ id: "cot-1" }) } as any
    )

    const escrito = ordenesChain.update.mock.calls.map((c: any[]) => c[0])
    expect(escrito).toContainEqual(
      expect.objectContaining({ presupuesto: 150, costo_final: 150 })
    )
  })
})
```

- [ ] **Step 2: Run it against the current code**

Run: `npx vitest run __tests__/api/cotizaciones-presupuesto-recalc.test.ts`
Expected: PASS. It documents today's behavior. If it fails, stop and fix the test until it passes against unmodified code — do not start the refactor with a red baseline.

- [ ] **Step 3: Commit the baseline**

```bash
git add __tests__/api/cotizaciones-presupuesto-recalc.test.ts
git commit -m "test(cotizaciones): fijar el presupuesto de la orden antes de tocarlo"
```

- [ ] **Step 4: Replace the helper body**

In `app/api/cotizaciones/[id]/route.ts`, add the import alongside the existing ones:

```ts
import { totalPresupuestoDeOrden, cotizacionesVigentesDeOrden } from "@/lib/cotizacion-presupuesto"
```

Replace the first eight lines of `recalcPresupuestoOrden` (the inline query plus the `reduce`) with:

```ts
  const { total, cantidad } = await totalPresupuestoDeOrden(ordenId)

  if (cantidad > 0) {
```

Leave the rest of the function untouched, including the `revertirOrdenSinPresupuestoActivo` branch.

- [ ] **Step 5: Replace the three remaining inline copies in the same file**

At ~636-642 (the ENVIADA → PRESUPUESTADO transition), replace the query and `reduce` with:

```ts
          const { total: totalPresupuesto } = await totalPresupuestoDeOrden(cotWithOrder.orden_id)
```

At ~750-755 (the delete guard that asks whether any other cotización remains), the site excludes the row being deleted, so it keeps its own query but must not duplicate the criterion. Replace with:

```ts
      const vigentes = await cotizacionesVigentesDeOrden(cotizacion.orden_id)
      const otrasCots = vigentes.length - 1 // la que se esta borrando sigue vigente en la lectura
      if (otrasCots <= 0) {
```

At ~793-799 (recalculation after delete), replace the query and `reduce` with:

```ts
        const { total: totalPresupuesto } = await totalPresupuestoDeOrden(cotizacion.orden_id)
```

- [ ] **Step 6: Replace the copies in the other two files**

`app/api/cotizaciones/[id]/enviar/route.ts` — add the import and replace lines 143-149 with:

```ts
        const { total: totalPresupuesto } = await totalPresupuestoDeOrden(orden.id)
```

`app/api/cotizaciones/route.ts` — add the import and replace lines 479-485 with:

```ts
      const { total: totalPresupuesto } = await totalPresupuestoDeOrden(data.ordenId)
```

- [ ] **Step 7: Verify nothing moved**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npx vitest run __tests__/api __tests__/lib`
Expected: PASS, including all 12 pre-existing `cotizaciones-*` suites and the new baseline. **Any failure here means the refactor changed behavior. Fix the code, never the test.**

- [ ] **Step 8: Confirm no inline copies survive**

Run: `rg -n 'neq\("estado", "RECHAZADA"\)' app/api lib`
Expected: exactly one hit, inside `lib/cotizacion-presupuesto.ts`.

- [ ] **Step 9: Commit**

```bash
git add app/api/cotizaciones lib/cotizacion-presupuesto.ts
git commit -m "refactor(cotizaciones): que los seis sitios pregunten por el presupuesto en un solo lugar"
```

---

# Slice 1 — The superseded pointer

### Task 3: Migration and exclusion

**Files:**
- Create: `supabase/migrations/<n>_cotizacion_reemplazada_por.sql`
- Create: `supabase/migrations/rollback/<n>_rollback.sql`
- Modify: `lib/cotizacion-presupuesto.ts`
- Modify: `__tests__/lib/cotizacion-presupuesto.test.ts`

**Interfaces:**
- Consumes: Task 1's module.
- Produces: `cotizaciones.reemplazada_por` (nullable TEXT FK to `cotizaciones(id)`); `NULL` means current.

- [ ] **Step 1: Write the migration**

Pick `<n>` as the next number above the highest committed migration on `origin/main`. Verify with:
`git ls-tree -r --name-only origin/main supabase/migrations | rg -o 'migrations/(\d+)' -r '$1' | sort -n | tail -1`

```sql
-- Migration <n>: una cotizacion puede quedar reemplazada por su revision.
--
-- Aceptar una cotizacion guarda la firma del cliente y reserva stock contra
-- esos items (migracion 246). Por eso una aceptada no se edita: la firma
-- quedaria describiendo un documento distinto del que firma. Para corregirla
-- se emite una revision, que es otra cotizacion, y la original queda congelada
-- apuntando a ella.
--
-- NULL = vigente. Con valor = fue reemplazada por esa revision.
--
-- No se usa un estado 'REEMPLAZADA' a proposito: esa fila FUE aceptada y
-- firmada, y eso es un hecho historico que pisar el estado borraria.

ALTER TABLE cotizaciones
  ADD COLUMN IF NOT EXISTS reemplazada_por TEXT REFERENCES cotizaciones(id),
  -- La otra punta: de que cotizacion nacio esta revision. Se escribe al crearla
  -- (Task 4) y se lee al enviarla (Task 5) para saber a quien marcar.
  ADD COLUMN IF NOT EXISTS revision_de TEXT REFERENCES cotizaciones(id);

-- El presupuesto de una orden filtra por esta columna en cada recalculo.
CREATE INDEX IF NOT EXISTS cotizaciones_reemplazada_por_idx
  ON cotizaciones(reemplazada_por)
  WHERE reemplazada_por IS NOT NULL;
```

Rollback:

```sql
-- Rollback de la migracion <n>.
--
-- Se pierde el vinculo entre una cotizacion reemplazada y su revision. Las
-- filas siguen existiendo: la aceptada conserva su firma y sus items, y la
-- revision conserva los suyos. Lo que vuelve es el doble conteo — el
-- presupuesto de una orden con revision va a sumar las dos versiones.
--
-- Revertir el codigo de la app junto con esto.

DROP INDEX IF EXISTS cotizaciones_reemplazada_por_idx;

ALTER TABLE cotizaciones
  DROP COLUMN IF EXISTS reemplazada_por,
  DROP COLUMN IF EXISTS revision_de;
```

- [ ] **Step 2: Write the failing test**

Add to `__tests__/lib/cotizacion-presupuesto.test.ts`:

```ts
  it("no cuenta las cotizaciones que ya fueron reemplazadas por una revision", async () => {
    const chain = createChainMock([{ total: 150 }])
    mockSupabaseFrom({ cotizaciones: chain })

    await totalPresupuestoDeOrden("orden-1")

    // La aceptada reemplazada y su revision conviven en la orden. Si el filtro
    // no esta, el presupuesto suma las dos y la orden cobra de mas.
    expect(chain.is).toHaveBeenCalledWith("reemplazada_por", null)
  })
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/cotizacion-presupuesto.test.ts`
Expected: FAIL — `is` was never called with `reemplazada_por`.

- [ ] **Step 4: Add the exclusion**

In `lib/cotizacion-presupuesto.ts`, add one line to the chain in `cotizacionesVigentesDeOrden`:

```ts
    .is("deleted_at", null)
    .is("reemplazada_por", null)
    .neq("estado", "RECHAZADA")
```

- [ ] **Step 5: Verify**

Run: `npx vitest run __tests__/lib __tests__/api`
Expected: PASS. Because Slice 0 consolidated the query, this single line covers all six original sites.

- [ ] **Step 6: Commit**

```bash
git add lib/cotizacion-presupuesto.ts __tests__/lib/cotizacion-presupuesto.test.ts supabase/migrations
git commit -m "feat(cotizaciones): sacar del presupuesto las cotizaciones reemplazadas"
```

- [ ] **Step 7: Expose the pointer to the client**

The GET mapping in `app/api/cotizaciones/[id]/route.ts` (~line 182, where `firmaAprobacion: c.firma_aprobacion` lives) and the list mapping in `app/api/cotizaciones/route.ts` (~line 103) convert snake_case rows to camelCase. Task 7's UI reads `cotizacion.reemplazadaPor`, so add to both:

```ts
    reemplazadaPor: c.reemplazada_por,
    revisionDe: c.revision_de,
```

Add the columns to the corresponding `.select(...)` lists in the same handlers, or the fields arrive `undefined` and the UI silently offers "Revisar" on an already-superseded row.

- [ ] **Step 8: Fix the guard that must not move**

The spec requires that revising never relaxes the in-place edit refusal. Append to `__tests__/api/cotizaciones-put-cost-preservation.test.ts`:

```ts
  it("sigue rechazando editar los items de una ACEPTADA, aunque exista el camino de revision", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      cotizaciones: createChainMock({
        id: "cot-1",
        estado: "ACEPTADA",
        organization_id: "org-1",
        reemplazada_por: null,
      }),
    })

    const { PUT } = await import("@/app/api/cotizaciones/[id]/route")
    const res = await PUT(
      new Request("http://localhost:3000/api/cotizaciones/cot-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ descripcion: "X", cantidad: 1, precioUnitario: 1 }] }),
      }) as any,
      { params: Promise.resolve({ id: "cot-1" }) } as any
    )

    const { status, body } = await parseResponse(res)
    expect(status).toBe(400)
    expect(body.error).toMatch(/aceptada o rechazada/i)
  })
```

Run: `npx vitest run __tests__/api/cotizaciones-put-cost-preservation.test.ts`
Expected: PASS immediately — the guard already exists. This test exists to make its removal loud.

- [ ] **Step 9: Hand the migration to the user**

Migrations are applied by hand in this project. Report the file path and stop — do not attempt to apply it. Note in the report that applying it before deploying the code is safe: a column that is `NULL` everywhere makes `.is("reemplazada_por", null)` a no-op, and the old code never reads the column.

---

# Slice 2 — Creating a revision

### Task 4: POST /api/cotizaciones/[id]/revisar

**Files:**
- Create: `app/api/cotizaciones/[id]/revisar/route.ts`
- Test: `__tests__/api/cotizaciones-revisar.test.ts`

**Interfaces:**
- Consumes: `requireAdmin` from `@/lib/auth-utils`, `supabaseAdmin`, the existing quote-number generator used by `app/api/cotizaciones/route.ts`.
- Produces: `POST` handler returning `{ id: string }` — the new `BORRADOR` revision's id.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/api/cotizaciones-revisar.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockAuthError, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

const call = async (id = "cot-1") => {
  const { POST } = await import("@/app/api/cotizaciones/[id]/revisar/route")
  return POST(
    new Request(`http://localhost:3000/api/cotizaciones/${id}/revisar`, { method: "POST" }) as any,
    { params: Promise.resolve({ id }) } as any
  )
}

describe("POST /api/cotizaciones/[id]/revisar", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("rechaza sin sesion", async () => {
    mockAuthError()
    expect((await parseResponse(await call())).status).toBe(401)
  })

  it("solo revisa cotizaciones ACEPTADAS", async () => {
    mockSupabaseFrom({
      cotizaciones: createChainMock({ id: "cot-1", estado: "BORRADOR", organization_id: "org-1" }),
    })
    const { status } = await parseResponse(await call())
    expect(status).toBe(400)
  })

  it("no toca la cotizacion firmada: solo inserta la revision", async () => {
    const cotChain = createChainMock({
      id: "cot-1",
      estado: "ACEPTADA",
      organization_id: "org-1",
      orden_id: "orden-1",
      n: "COT-0001",
      firma_aprobacion: "data:image/png;base64,AAA",
      total: 100,
    })
    mockSupabaseFrom({
      cotizaciones: cotChain,
      items_cotizacion: createChainMock([{ descripcion: "X", cantidad: 1, precio_unitario: 100 }]),
    })

    const { status } = await parseResponse(await call())

    expect(status).toBe(201)
    expect(cotChain.update).not.toHaveBeenCalled()
    expect(cotChain.insert).toHaveBeenCalled()
  })

  it("la revision nace en BORRADOR y conserva el numero de la original", async () => {
    const cotChain = createChainMock({
      id: "cot-1",
      estado: "ACEPTADA",
      organization_id: "org-1",
      orden_id: "orden-1",
      n: "COT-0001",
      total: 100,
    })
    mockSupabaseFrom({
      cotizaciones: cotChain,
      items_cotizacion: createChainMock([{ descripcion: "X", cantidad: 1, precio_unitario: 100 }]),
    })

    await call()

    const insertado = cotChain.insert.mock.calls[0][0]
    expect(insertado).toEqual(
      expect.objectContaining({ estado: "BORRADOR", n: "COT-0001", orden_id: "orden-1" })
    )
    // La firma es de la original y no se hereda: la revision se firma de nuevo.
    expect(insertado.firma_aprobacion ?? null).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/api/cotizaciones-revisar.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Read `app/api/cotizaciones/route.ts`'s POST first to copy its item-insert shape and its auth pattern verbatim; this route must produce rows indistinguishable from a normally-created cotización except for `revision_de` semantics. Key rules:

- Load the source row; 404 if missing or not in the caller's org.
- 400 unless `estado === "ACEPTADA"`.
- Insert a new cotización copying `orden_id`, `cliente_id`, `n`, `terminos`, `iva_porcentaje`, `descuento_global_tipo`, `descuento_global_valor`, with `estado: "BORRADOR"`.
- Never copy `firma_aprobacion`, `firma_mime`, `fecha_aprobacion`, `public_token`.
- Copy the source's `items_cotizacion` rows to the new id.
- Do **not** write `reemplazada_por` yet — that happens on send (Task 5), so an abandoned draft never orphans the accepted row.
- Return `201` with `{ id }`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run __tests__/api/cotizaciones-revisar.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add app/api/cotizaciones/[id]/revisar __tests__/api/cotizaciones-revisar.test.ts
git commit -m "feat(cotizaciones): endpoint que clona una aceptada en una revision borrador"
```

---

### Task 5: Mark superseded on send

**Files:**
- Modify: `app/api/cotizaciones/[id]/enviar/route.ts`
- Test: `__tests__/api/cotizaciones-revisar.test.ts` (extend)

**Interfaces:**
- Consumes: `revision_de` written by Task 4.
- Produces: on send of a revision, its source row gets `reemplazada_por = <revision id>`.

- [ ] **Step 1: Write the failing test**

```ts
  it("al enviar la revision, marca la original como reemplazada", async () => {
    const cotChain = createChainMock({
      id: "rev-1",
      estado: "BORRADOR",
      organization_id: "org-1",
      orden_id: "orden-1",
      revision_de: "cot-1",
      total: 120,
    })
    mockSupabaseFrom({
      cotizaciones: cotChain,
      ordenes_servicio: createChainMock({ id: "orden-1", estado: "APROBADO" }),
      orden_eventos: createChainMock(null),
    })

    const { POST } = await import("@/app/api/cotizaciones/[id]/enviar/route")
    await POST(
      new Request("http://localhost:3000/api/cotizaciones/rev-1/enviar", { method: "POST" }) as any,
      { params: Promise.resolve({ id: "rev-1" }) } as any
    )

    const updates = cotChain.update.mock.calls.map((c: any[]) => c[0])
    expect(updates).toContainEqual(expect.objectContaining({ reemplazada_por: "rev-1" }))
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/api/cotizaciones-revisar.test.ts -t "reemplazada"`
Expected: FAIL — no such update.

- [ ] **Step 3: Implement**

In the send route, after the row transitions to `ENVIADA` and before the orden recalculation, add:

```ts
    // Una revision reemplaza a su original recien cuando se envia. Antes de eso
    // es un borrador que se puede abandonar sin dejar huerfana a la aceptada.
    if (cotizacion.revision_de) {
      await supabaseAdmin
        .from("cotizaciones")
        .update({ reemplazada_por: cotizacion.id })
        .eq("id", cotizacion.revision_de)
        .eq("organization_id", organizationId!)
    }
```

Order matters: the mark must land **before** `totalPresupuestoDeOrden` runs, or the recalculation counts both versions.

- [ ] **Step 4: Verify**

Run: `npx vitest run __tests__/api`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/api/cotizaciones/[id]/enviar __tests__/api/cotizaciones-revisar.test.ts
git commit -m "feat(cotizaciones): marcar la original como reemplazada al enviar su revision"
```

---

# Slice 3 — Reservation reconciliation

### Task 6: Release the superseded row's reservations on approval

**Files:**
- Create: `supabase/migrations/<n+1>_aprobar_revision_reconcilia_reservas.sql` + rollback
- Test: `__tests__/api/aprobar-cotizacion-atomica.test.ts` (extend)

**Interfaces:**
- Consumes: `aprobar_cotizacion_atomica` (migration 246), `liberar_items_cotizacion`.
- Produces: same RPC signature; additionally releases the superseded row's reservations inside the same transaction.

- [ ] **Step 1: Read the precedent**

Read `supabase/migrations/246_cotizacion_reserva_atomica.sql` end to end, including the `convertir_cotizacion_venta_atomica` half. It wraps `liberar` and `crear` in one function specifically to prevent the phantom-reservation bug where `stock_reservado` stays inflated forever. This task mirrors that shape; do not invent a different one.

- [ ] **Step 2: Write the failing test**

Append to `__tests__/api/aprobar-cotizacion-atomica.test.ts`:

```ts
  it("al aprobar una revision, libera las reservas de la cotizacion que reemplaza", async () => {
    // La aceptada original reservo stock contra SUS items. Si la revision
    // reserva los suyos sin liberar aquellos, stock_reservado queda inflado
    // para siempre — el bug fantasma que documenta la migracion 246.
    const rpc = vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { ok: true, liberadas: ["cot-1"] },
      error: null,
    } as any)

    const { POST } = await import("@/app/api/cotizaciones/[id]/aprobar/route")
    await POST(
      new Request("http://localhost:3000/api/cotizaciones/rev-1/aprobar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firma: "data:image/png;base64,AAA" }),
      }) as any,
      { params: Promise.resolve({ id: "rev-1" }) } as any
    )

    expect(rpc).toHaveBeenCalledWith(
      "aprobar_cotizacion_atomica",
      expect.objectContaining({ p_cotizacion_id: "rev-1" })
    )
    expect(rpc.mock.results[0].value).resolves.toEqual(
      expect.objectContaining({ data: expect.objectContaining({ liberadas: ["cot-1"] }) })
    )
  })
```

Read the file first: the route path and the RPC argument names must match what that suite already uses. If `POST /aprobar` lives elsewhere, use the real path rather than the one written here.

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run __tests__/api/aprobar-cotizacion-atomica.test.ts`
Expected: FAIL.

- [ ] **Step 4: Extend the RPC**

Copy the whole existing `aprobar_cotizacion_atomica` body from migration 246 into the new migration and insert this block after the estado/firma `UPDATE` and **before** `reservar_items_cotizacion`:

```sql
  -- Si esto es una revision, la cotizacion que reemplaza tiene stock reservado
  -- contra SUS items. Se libera antes de reservar los nuevos: al reves, una
  -- pieza presente en las dos versiones quedaria contada dos veces aunque sea
  -- por un instante, y cualquier error posterior la dejaria inflada.
  -- Mismo patron que convertir_cotizacion_venta_atomica (migracion 246).
  IF v_cot.revision_de IS NOT NULL THEN
    PERFORM liberar_items_cotizacion(v_cot.revision_de);
  END IF;
```

Keep the signature byte-identical — callers pass positional args and a changed signature would leave the old overload resolvable.

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run __tests__/api`
Expected: PASS.

```bash
git add supabase/migrations __tests__/api/aprobar-cotizacion-atomica.test.ts
git commit -m "feat(cotizaciones): reconciliar reservas al aprobar una revision"
```

---

# Slice 4 — UI

### Task 7: "Revisar" action and superseded rendering

**Files:**
- Modify: `components/cotizaciones/cotizacion-list.tsx`
- Test: `__tests__/components/cotizacion-list-revisar.test.tsx` (create)

**Interfaces:**
- Consumes: `POST /api/cotizaciones/[id]/revisar` from Task 4.
- Produces: no exported API.

- [ ] **Step 1: Write the failing test**

Model the file on `__tests__/components/cotizacion-list-editar-enviada.test.tsx`, which already mocks `swr`, `useHasFeature` and `currency-context` for this component. Assert:

```ts
  it("ofrece Revisar en una ACEPTADA, y no Editar", () => {
    // estado ACEPTADA, reemplazada_por null
    expect(screen.getByRole("button", { name: /Revisar/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Editar/ })).not.toBeInTheDocument()
  })

  it("no ofrece Revisar sobre una cotizacion ya reemplazada", () => {
    // estado ACEPTADA, reemplazada_por: "rev-1"
    expect(screen.queryByRole("button", { name: /Revisar/ })).not.toBeInTheDocument()
  })

  it("avisa que la orden tiene una revision sin firmar", () => {
    // una ACEPTADA reemplazada + su revision en ENVIADA
    expect(screen.getByText(/revisión pendiente de firma/i)).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/components/cotizacion-list-revisar.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

The `canEdit` computation currently reads (after the merged #339):

```ts
const canEdit = !["ACEPTADA", "RECHAZADA"].includes(cotizacion.estado)
```

Add beside it:

```ts
// Una aceptada no se edita: se revisa. La revision es una cotizacion nueva y
// la firmada queda congelada — ver el diseño en docs/superpowers/specs/
// 2026-08-25-revision-cotizacion-aceptada-design.md
const canRevisar = cotizacion.estado === "ACEPTADA" && !cotizacion.reemplazadaPor
```

Render the "Revisar" button under `canRevisar`, calling the Task 4 endpoint and then opening the returned draft in the existing edit form. Render superseded rows collapsed and labelled as a previous version, keeping their signature visible via the existing `SignatureDisplay`. Show the pending-revision notice when the orden holds a superseded row whose revision is still `ENVIADA`.

Copy is Spanish, matching the surrounding UI.

- [ ] **Step 4: Verify**

Run: `npx vitest run __tests__/components`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add components/cotizaciones/cotizacion-list.tsx __tests__/components/cotizacion-list-revisar.test.tsx
git commit -m "feat(cotizaciones): revisar una aceptada desde la lista de la orden"
```

---

## Review Workload Forecast

Slice 0 is a pure refactor and should be its own PR — a reviewer can approve it on the strength of "no test moved" alone, which is exactly the property that stops being checkable once feature changes are mixed in.

Slices 1-3 form the server-side feature and are reviewable together. Slice 4 is UI and can chain behind them.

Estimated changed lines: Slice 0 ~120, Slices 1-3 ~250, Slice 4 ~150. Each lands under the 400-line ceiling, so no `size:exception` is needed. Chained PRs recommended: Yes. Decision needed before apply: No — the slice boundaries above are the split.

## Manual verification (cannot be automated here)

- Apply the migrations by hand; `scripts/db-run.mjs` needs `SUPABASE_DB_URL`, which has been unavailable in this environment.
- Revise an accepted cotización end to end: confirm the original keeps its signature and items, the revision arrives at the customer's link, and the orden's budget shows the revision's total and not the sum of both.
- Confirm `stock_reservado` on a part present in both versions ends at the revision's quantity.
