# Fuente única para transiciones de estado de órdenes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rutear todas las escrituras de `estado` de `ordenes_servicio` a través de un helper único que valida con la máquina de estados y hace un UPDATE atómico, cerrando el bug #6a y las carreras TOCTOU.

**Architecture:** Un helper `transicionarOrden(supabase, params)` en `lib/orden-transicion.ts` centraliza `esTransicionValida()` + UPDATE con guarda de concurrencia (`.eq("estado", esperado)`). `lib/orden-state-machine.ts` se mantiene puro. Las ~10 escrituras existentes se migran al helper. Se entrega en 3 PRs encadenadas.

**Tech Stack:** Next.js (App Router, route handlers), TypeScript, Supabase JS, Vitest.

## Global Constraints

- Tests con Vitest (`npx vitest run <archivo>`). Helpers de mock en `__tests__/api/helpers.ts` (`createChainMock`, `mockSupabaseFrom`, `mockAuthSuccess`, `createPostRequest`, `parseResponse`).
- TDD estricto: test que falla → implementación mínima → test que pasa → commit.
- Commits conventional, en español, sin `Co-Authored-By`.
- `lib/orden-state-machine.ts` NO importa Supabase (se mantiene puro). El helper con DB vive en `lib/orden-transicion.ts`.
- Los `orden_eventos` y notificaciones se emiten SOLO en `ok: true`.
- Branch base de esta fase: `refactor/orden-transicion-fuente-unica` (ya creada, con el spec commiteado).

## Entrega en 3 PRs encadenadas

- **PR1 (Fase 1):** helper + unit tests. Sin cambio de comportamiento. ← detallada abajo, paso a paso.
- **PR2 (Fase 2):** migrar rutas de cotización + fix #6a (bloqueo APROBADO). ← inventario de tareas.
- **PR3 (Fase 3):** migrar rutas de portal + webhook. ← inventario de tareas.

> Las Fases 2 y 3 se expanden a nivel-paso (código exacto + tests) **al momento de ejecutarlas**, contra el `main` ya con PR1 mergeada — así los números de línea y el shape del helper compartido son los reales. Abajo va el inventario concreto de cada tarea (archivo, transformación, decisión flagged, test).

---

# FASE 1 — Helper `transicionarOrden` (PR1)

### Task 1: Helper de transición atómica

**Files:**
- Create: `lib/orden-transicion.ts`
- Test: `lib/__tests__/orden-transicion.test.ts`

**Interfaces:**
- Consumes: `esTransicionValida`, `getMensajeTransicionInvalida` de `lib/orden-state-machine.ts`; tipo `EstadoOrden` de `@/types`.
- Produces:
  - `type ResultadoTransicion = { ok: true; estado: EstadoOrden } | { ok: false; motivo: "TRANSICION_INVALIDA"; mensaje: string } | { ok: false; motivo: "ESTADO_CAMBIO" }`
  - `interface TransicionarOrdenParams { ordenId: string; organizationId: string; esperado: EstadoOrden; nuevo: EstadoOrden; camposExtra?: Record<string, unknown> }`
  - `async function transicionarOrden(supabase: SupabaseClient, params: TransicionarOrdenParams): Promise<ResultadoTransicion>`

- [ ] **Step 1: Escribir los tests que fallan**

Create `lib/__tests__/orden-transicion.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import { transicionarOrden } from "../orden-transicion"

// Mock mínimo de un cliente Supabase: la cadena es thenable y resuelve { data, error }.
function mockSupabase(finalData: any, finalError: any = null) {
  const chain: any = {}
  for (const m of ["update", "eq", "select"]) chain[m] = vi.fn().mockReturnValue(chain)
  chain.then = (resolve: any, reject?: any) =>
    Promise.resolve({ data: finalData, error: finalError }).then(resolve, reject)
  const from = vi.fn().mockReturnValue(chain)
  return { supabase: { from } as any, chain, from }
}

describe("transicionarOrden", () => {
  const base = { ordenId: "o1", organizationId: "org-1" as string }

  it("rechaza una transición inválida sin tocar la DB", async () => {
    const { supabase, from } = mockSupabase(null)
    const res = await transicionarOrden(supabase, {
      ...base, esperado: "APROBADO", nuevo: "EN_DIAGNOSTICO",
    })
    expect(res).toEqual({
      ok: false, motivo: "TRANSICION_INVALIDA", mensaje: expect.stringContaining("APROBADO"),
    })
    expect(from).not.toHaveBeenCalled()
  })

  it("aplica una transición válida cuando el UPDATE afecta 1 fila", async () => {
    const { supabase, chain } = mockSupabase([{ id: "o1" }])
    const res = await transicionarOrden(supabase, {
      ...base, esperado: "PRESUPUESTADO", nuevo: "APROBADO",
    })
    expect(res).toEqual({ ok: true, estado: "APROBADO" })
    expect(chain.eq).toHaveBeenCalledWith("estado", "PRESUPUESTADO")
    expect(chain.eq).toHaveBeenCalledWith("id", "o1")
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("devuelve ESTADO_CAMBIO cuando el UPDATE afecta 0 filas (race)", async () => {
    const { supabase } = mockSupabase([])
    const res = await transicionarOrden(supabase, {
      ...base, esperado: "PRESUPUESTADO", nuevo: "APROBADO",
    })
    expect(res).toEqual({ ok: false, motivo: "ESTADO_CAMBIO" })
  })

  it("pasa camposExtra al UPDATE junto con el estado", async () => {
    const { supabase, chain } = mockSupabase([{ id: "o1" }])
    await transicionarOrden(supabase, {
      ...base, esperado: "PRESUPUESTADO", nuevo: "APROBADO", camposExtra: { costo_final: 5000 },
    })
    expect(chain.update).toHaveBeenCalledWith({ estado: "APROBADO", costo_final: 5000 })
  })

  it("lanza si la DB devuelve error", async () => {
    const { supabase } = mockSupabase(null, { message: "boom" })
    await expect(
      transicionarOrden(supabase, { ...base, esperado: "PRESUPUESTADO", nuevo: "APROBADO" })
    ).rejects.toBeTruthy()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run lib/__tests__/orden-transicion.test.ts`
Expected: FAIL — `Failed to resolve import "../orden-transicion"` / `transicionarOrden is not a function`.

- [ ] **Step 3: Implementar el helper**

Create `lib/orden-transicion.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js"
import type { EstadoOrden } from "@/types"
import { esTransicionValida, getMensajeTransicionInvalida } from "@/lib/orden-state-machine"

export type ResultadoTransicion =
  | { ok: true; estado: EstadoOrden }
  | { ok: false; motivo: "TRANSICION_INVALIDA"; mensaje: string }
  | { ok: false; motivo: "ESTADO_CAMBIO" }

export interface TransicionarOrdenParams {
  ordenId: string
  organizationId: string
  /** Estado en el que el caller cree que está la orden (guarda de concurrencia). */
  esperado: EstadoOrden
  /** Estado destino. */
  nuevo: EstadoOrden
  /** Columnas extra a escribir en el mismo UPDATE atómico (presupuesto, costo_final, firmas, etc.). */
  camposExtra?: Record<string, unknown>
}

/**
 * Aplica una transición de estado de forma atómica: valida contra la máquina
 * de estados y hace el UPDATE condicionado a `estado = esperado`, de modo que
 * dos requests concurrentes no puedan pisarse. Fuente única para cambiar el
 * estado de una orden fuera del PUT genérico.
 */
export async function transicionarOrden(
  supabase: SupabaseClient,
  { ordenId, organizationId, esperado, nuevo, camposExtra }: TransicionarOrdenParams
): Promise<ResultadoTransicion> {
  if (!esTransicionValida(esperado, nuevo)) {
    return {
      ok: false,
      motivo: "TRANSICION_INVALIDA",
      mensaje: getMensajeTransicionInvalida(esperado, nuevo),
    }
  }

  const { data, error } = await supabase
    .from("ordenes_servicio")
    .update({ estado: nuevo, ...camposExtra })
    .eq("id", ordenId)
    .eq("organization_id", organizationId)
    .eq("estado", esperado)
    .select("id")

  if (error) throw error
  if (!data || data.length === 0) {
    return { ok: false, motivo: "ESTADO_CAMBIO" }
  }
  return { ok: true, estado: nuevo }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run lib/__tests__/orden-transicion.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/orden-transicion.ts lib/__tests__/orden-transicion.test.ts
git commit -m "feat(ordenes): helper transicionarOrden (validacion + update atomico)"
```

- [ ] **Step 7: Abrir PR1**

```bash
git push -u origin refactor/orden-transicion-fuente-unica
gh pr create --base main --title "refactor(ordenes): helper transicionarOrden para transiciones atomicas" --body "<resumen: helper + tests, sin cambio de comportamiento; base de la deuda amplia>"
```

Verificar CI verde (Unit Tests, Lint, Build, E2E) antes de mergear.

---

# FASE 2 — Rutas de cotización + fix #6a (PR2)

> Base: `main` con PR1 mergeada. Branch: `refactor/orden-cotizaciones-transicion` (off main). Expandir cada tarea a nivel-paso (test-first) al ejecutar.

### Task 2.1: `aplicarAprobacionCotizacionAOrden` usa el helper

**Files:** Modify `lib/cotizacion-aprobar-orden.ts`. Test: `lib/__tests__/cotizacion-aprobar-orden.test.ts` (crear si no existe).

- Reemplazar el `.update({...}).eq("id", orden.id)` (líneas ~77-89) por `transicionarOrden(supabaseAdmin, { ordenId: orden.id, organizationId: orden.organization_id, esperado: "PRESUPUESTADO", nuevo: "APROBADO", camposExtra: { presupuesto: cotizacionTotal, costo_final: cotizacionTotal, presupuesto_aprobado_portal: aprobadoDesdePortal, presupuesto_fecha_aprobacion: new Date().toISOString(), ...camposAdicionalesOrden } })`.
- Emitir el evento `PRESUPUESTO_APROBADO` + notificación SOLO si `resultado.ok`.
- **Firma / decisión flagged:** hoy devuelve `boolean`. La guarda `if (orden.estado !== "PRESUPUESTADO") return false` se vuelve redundante (el helper lo cubre) pero se mantiene para el early-return sin tocar DB. **Decisión de retorno:** mantener `Promise<boolean>` (`true` = aplicado; `false` = no-aplicado por no estar en PRESUPUESTADO **o** por `ESTADO_CAMBIO`). Los 3 callers hoy tratan `false` como "efecto condicional no ocurrido" → mantener ese contrato evita tocar los 3 callers. **En approve flows, `ESTADO_CAMBIO` ≈ "otro request ya aprobó" → idempotente, no es error.**
- Tests: aprobar desde PRESUPUESTADO (ok, evento+notif); desde otro estado (false, sin DB write ni evento); race 0-filas (false, sin evento duplicado).

### Task 2.2: Fix #6a — bloquear borrado de última cotización en APROBADO

**Files:** Modify `app/api/cotizaciones/[id]/route.ts` (handler `DELETE`, ~línea 636; y `recalcPresupuestoOrden`, ~110-135; y `revertirOrdenSinPresupuestoActivo`, ~79-108). Test: `__tests__/api/cotizaciones-delete.test.ts` (crear).

- En el `DELETE` (y cualquier path de desvinculación): antes de borrar, si tras quitar esta cotización quedan **0 cotizaciones activas** y la orden está en `APROBADO` → responder `400` `{ error: "No se puede borrar la última cotización de una orden aprobada. Cancelá o mové la orden primero." }`. No borrar.
- `revertirOrdenSinPresupuestoActivo`: reemplazar el `.update({ estado: "EN_DIAGNOSTICO", ... }).eq("id", ordenId)` por `transicionarOrden(supabaseAdmin, { ordenId, organizationId, esperado: "PRESUPUESTADO", nuevo: "EN_DIAGNOSTICO", camposExtra: { presupuesto: null, costo_final: null, presupuesto_aprobado_portal: false, presupuesto_firma_url: null, presupuesto_fecha_aprobacion: null } })`. Emitir evento solo si `ok`.
- `recalcPresupuestoOrden` (línea 130): quitar `APROBADO` de la condición → solo `orden.estado === "PRESUPUESTADO"` llega a `revertir`. (El caso APROBADO ya está bloqueado en el DELETE.)
- Tests: DELETE última cotización con orden APROBADO → 400, no borra; DELETE última con orden PRESUPUESTADO → borra + orden pasa a EN_DIAGNOSTICO; DELETE cuando quedan otras cotizaciones → borra, no toca estado.

### Task 2.3: `cotizaciones/[id]:505` (compartir cotización → PRESUPUESTADO) usa el helper

**Files:** Modify `app/api/cotizaciones/[id]/route.ts` (~486-509). Test: extender el test del PUT de cotizaciones.

- Reemplazar el bloque `validStates.includes(...)` + `.update({ estado: "PRESUPUESTADO", ... }).eq("id", ordenActual.id)` por `transicionarOrden(supabaseAdmin, { ordenId: ordenActual.id, organizationId, esperado: ordenActual.estado, nuevo: "PRESUPUESTADO", camposExtra: { presupuesto: totalPresupuesto, costo_final: totalPresupuesto } })`.
- Como `esperado` es dinámico (RECIBIDO o EN_DIAGNOSTICO), si `ordenActual.estado` no es válido para PRESUPUESTADO el helper devuelve `TRANSICION_INVALIDA` → no aplicar, no emitir evento (mantiene el efecto condicional actual). Emitir evento solo si `ok`.
- Tests: desde RECIBIDO → PRESUPUESTADO ok; desde EN_DIAGNOSTICO → ok; desde APROBADO → no-op (no evento).

### Task 2.4: `cotizaciones/[id]/enviar:153` usa el helper

**Files:** Modify `app/api/cotizaciones/[id]/enviar/route.ts` (~134-157). Test: `__tests__/api/cotizaciones-enviar.test.ts` (crear o extender).

- Mismo patrón que 2.3: `transicionarOrden(..., esperado: ordenActual.estado, nuevo: "PRESUPUESTADO", camposExtra: { presupuesto: totalPresupuesto, costo_final: totalPresupuesto })`. Evento solo si `ok`.
- Tests: enviar desde RECIBIDO/EN_DIAGNOSTICO → PRESUPUESTADO; re-enviar cuando ya está PRESUPUESTADO → no-op de estado (email/PDF siguen su curso, fuera de scope).

### Task 2.5: PR2

```bash
git push -u origin refactor/orden-cotizaciones-transicion
gh pr create --base main --title "refactor(ordenes): rutas de cotizacion via transicionarOrden + fix #6a" --body "<...>"
```

---

# FASE 3 — Rutas de portal + webhook (PR3)

> Base: `main` con PR2 mergeada. Branch: `refactor/orden-portal-transicion` (off main). Expandir a nivel-paso al ejecutar.

### Task 3.1: `public/approve-budget` usa el helper

**Files:** Modify `app/api/public/ordenes/[token]/approve-budget/route.ts` (~59-70). Test: `__tests__/api/approve-budget.test.ts` (crear o extender).

- Reemplazar `.update({ estado: "APROBADO", ... }).eq("id", orden.id)` por `transicionarOrden(supabaseAdmin, { ordenId: orden.id, organizationId: orden.organization_id, esperado: "PRESUPUESTADO", nuevo: "APROBADO", camposExtra: { costo_final: orden.presupuesto, presupuesto_aprobado_portal: true, presupuesto_firma_url: firmaUrl, presupuesto_firma_path: firmaPath, presupuesto_fecha_aprobacion: new Date().toISOString() } })`.
- **Decisión flagged (approve):** en `ESTADO_CAMBIO`, responder idempotente (200 "ya aprobada") en vez de 400 — otro request/tab ya aprobó. Evento+notif solo si `ok`.
- Mantener la guarda previa `if (orden.estado !== "PRESUPUESTADO")` como early-return (evita subir firma en vano).

### Task 3.2: `public/reject-budget` usa el helper

**Files:** Modify `app/api/public/ordenes/[token]/reject-budget/route.ts` (~36-47). Test: crear/extender.

- Reemplazar por `transicionarOrden(..., esperado: "PRESUPUESTADO", nuevo: "EN_DIAGNOSTICO", camposExtra: { presupuesto: null, costo_final: null, presupuesto_aprobado_portal: false, presupuesto_firma_url: null, presupuesto_firma_path: null, presupuesto_fecha_aprobacion: null })`. Evento solo si `ok`. En `ESTADO_CAMBIO` → 200 idempotente.

### Task 3.3: `public/cotizaciones/[token]/rechazar` usa el helper

**Files:** Modify `app/api/public/cotizaciones/[token]/rechazar/route.ts` (~70-74). Test: crear/extender.

- Reemplazar el `if (orden.estado === "PRESUPUESTADO") { .update({ estado: "EN_DIAGNOSTICO" }) }` por `transicionarOrden(..., esperado: "PRESUPUESTADO", nuevo: "EN_DIAGNOSTICO")`. Ya está protegido por el guard de la cotización (`estado !== "ENVIADA"`); mantener. Evento solo si `ok`.

### Task 3.4: `whatsapp/webhook` usa el helper

**Files:** Modify `app/api/whatsapp/webhook/route.ts` (~197-206). Test: extender el test del webhook si existe.

- Reemplazar el `.update({ estado: "APROBADO", ... }).eq("id", orden.id)` por `transicionarOrden(..., esperado: "PRESUPUESTADO", nuevo: "APROBADO", camposExtra: { presupuesto_aprobado_portal: true, presupuesto_fecha_aprobacion: new Date().toISOString() })`.
- **Decisión flagged (bot):** en `ESTADO_CAMBIO` o `TRANSICION_INVALIDA` → **no-op silencioso** (no hay UX de error). No emitir evento ni notificación.

### Task 3.5: PR3 + verificación final

```bash
git push -u origin refactor/orden-portal-transicion
gh pr create --base main --title "refactor(ordenes): rutas de portal y webhook via transicionarOrden" --body "<...>"
```

- Barrido final: `grep` de `.from("ordenes_servicio").update(` para confirmar que ninguna escritura de `estado` quedó fuera del helper (excepto PUT y /entregar, ya gateados).

---

## Self-Review

- **Spec coverage:** helper (§1) → Task 1. Wiring de las 10 llamadas (§2) → Tasks 2.1, 2.3, 2.4, 3.1–3.4. Fix #6a (§3) → Task 2.2. Error handling (§4) → decisiones flagged en cada task (bot no-op, portal idempotente/400). Testing (§5) → tests en cada task. Entrega en 3 PRs (§6) → Fases 1/2/3.
- **Placeholders:** Fase 1 tiene código completo. Fases 2/3 son inventario de tareas con transformación exacta (helper call + esperado/nuevo/camposExtra) — se expanden a step-level al ejecutar contra el base mergeado. Explícito, no placeholder.
- **Type consistency:** `ResultadoTransicion` / `transicionarOrden` / `TransicionarOrdenParams` usados consistentemente. `esperado`/`nuevo`/`camposExtra` en todas las tasks.
