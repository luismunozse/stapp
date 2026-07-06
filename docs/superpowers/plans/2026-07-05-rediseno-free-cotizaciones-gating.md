# Rediseño Free vs Profesional — gating de cotizaciones — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover `cotizaciones_online` del plan Free a Profesional, enforzando la feature en el backend (hoy el flag no se chequea) y la UI, con históricos read-only, y sincronizar el landing.

**Architecture:** Guard `hasPlanFeature(org, "cotizaciones_online")` en las rutas que CREAN cotizaciones (crear/editar/enviar/duplicar) → 403; se dejan abiertas las de lectura y cierre (aprobar/convertir). UI: ocultar puntos de creación vía `useHasFeature` + banner de upgrade. Migración 266 apaga el flag en Free (preserva POS y seguimiento). Rollout: deploy del gating con flag aún prendido → aviso → correr migración.

**Tech Stack:** Next.js (App Router) + Supabase + Vitest.

## Global Constraints

- **Feature key exacta:** `cotizaciones_online`. NO tocar `pos_sales` ni `client_portal` (quedan en Free).
- **Shape del 403 (verbatim):** `{ error: "Las cotizaciones requieren el plan Profesional", code: "FEATURE_REQUIRED", feature: "cotizaciones_online" }`, status `403`. Mismo patrón que `app/api/whatsapp/send/route.ts:25-31`.
- **Primitivo:** `hasPlanFeature(organizationId, featureKey)` de `@/lib/subscriptions` (async, respeta trial/período/override). Cliente: `useHasFeature(featureKey)` de `@/hooks/use-subscription` → `{ hasFeature, loading }`.
- **Gate DESPUÉS de `requireAuth`**: insertar justo tras `if (error) return error`. Las rutas destructuran `{ error, organizationId, ... } = await requireAuth()`.
- **Rutas gateadas (crean/producen cotización):** `POST /api/cotizaciones`, `PUT /api/cotizaciones/[id]`, `POST /api/cotizaciones/[id]/enviar`, `POST /api/cotizaciones/[id]/duplicar`, `POST /api/cotizacion-templates`. **NO gatear:** GET (listar/[id]/historial/pdf), `aprobar`, `convertir-orden`, `convertir-venta`, ni las rutas públicas `app/api/public/cotizaciones/[token]/**`.
- **Tests:** Vitest. Helpers en `__tests__/api/helpers.ts` (`mockAuthSuccess`, `mockAuthError`, `createPostRequest`, `parseResponse`). Mockear `@/lib/subscriptions`. Comando: `npx vitest run <archivo>`.
- **Migración:** próximo número **266**, idempotente en la práctica (UPDATE por slug).
- **Idioma artefactos:** identificadores/comentarios en español neutro; copy UI en rioplatense como el resto.
- **Commits:** conventional, sin `Co-Authored-By`.

---

## File Structure

**Slice 1 — Backend gating (PR #1, deploy-safe):**
- Modify: `app/api/cotizaciones/route.ts` (POST) — add gate.
- Modify: `app/api/cotizaciones/[id]/route.ts` (PUT) — add gate.
- Modify: `app/api/cotizaciones/[id]/enviar/route.ts` (POST) — add gate.
- Modify: `app/api/cotizaciones/[id]/duplicar/route.ts` (POST) — add gate.
- Modify: `app/api/cotizacion-templates/route.ts` (POST) — add gate.
- Create: `__tests__/api/cotizaciones-feature-gating.test.ts` — gate tests.

**Slice 2 — UI gating + landing (PR #2):**
- Modify: `app/(dashboard)/cotizaciones/page.tsx` — gate create/edit/send/duplicate entry points + banner.
- Modify: `components/landing/pricing-section.tsx` — sync Free/Pro feature lists.

**Slice 3 — Migración + rollout (PR #3):**
- Create: `supabase/migrations/266_free_v3_cotizaciones_gating.sql` — apaga el flag en Free.
- Create: `components/cotizaciones/cotizaciones-upgrade-banner.tsx` — banner de transición/upgrade (reutilizable).

---

## SLICE 1 — Backend gating (PR #1)

### Task 1: Gate en `POST /api/cotizaciones` + archivo de test

**Files:**
- Modify: `app/api/cotizaciones/route.ts` (dentro de `export async function POST`, tras `requireAuth`)
- Test: `__tests__/api/cotizaciones-feature-gating.test.ts`

**Interfaces:**
- Consumes: `hasPlanFeature` de `@/lib/subscriptions`; helpers de `./helpers`.
- Produces: el patrón de gate que replican Task 2 (mismo bloque de 403).

- [ ] **Step 1: Escribir el test que falla**

```typescript
// __tests__/api/cotizaciones-feature-gating.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockAuthError, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

import { hasPlanFeature } from "@/lib/subscriptions"
import { POST as crearCotizacion } from "@/app/api/cotizaciones/route"

describe("gating de cotizaciones_online — POST /api/cotizaciones", () => {
  beforeEach(() => vi.clearAllMocks())

  it("401 si no está autenticado", async () => {
    mockAuthError()
    const res = await crearCotizacion(createPostRequest({}))
    const { status } = await parseResponse(res)
    expect(status).toBe(401)
  })

  it("403 FEATURE_REQUIRED cuando el plan no tiene cotizaciones_online", async () => {
    mockAuthSuccess()
    vi.mocked(hasPlanFeature).mockResolvedValueOnce(false)
    const res = await crearCotizacion(createPostRequest({ items: [] }))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(403)
    expect(body.code).toBe("FEATURE_REQUIRED")
    expect(body.feature).toBe("cotizaciones_online")
  })

  it("pasa el gate (no 403) cuando el plan tiene la feature", async () => {
    mockAuthSuccess()
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    const res = await crearCotizacion(createPostRequest({ items: [] }))
    const { status } = await parseResponse(res)
    expect(status).not.toBe(403)
  })
})
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `npx vitest run __tests__/api/cotizaciones-feature-gating.test.ts`
Expected: FAIL en el caso 403 — hoy la ruta no chequea la feature, devuelve otro status.

- [ ] **Step 3: Agregar el gate a la ruta**

En `app/api/cotizaciones/route.ts`: agregar el import (junto a los existentes en la cabecera):

```typescript
import { hasPlanFeature } from "@/lib/subscriptions"
```

Y dentro de `export async function POST(request: Request)`, inmediatamente después de:

```typescript
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error
```

insertar:

```typescript
    const hasCotizaciones = await hasPlanFeature(organizationId!, "cotizaciones_online")
    if (!hasCotizaciones) {
      return NextResponse.json(
        { error: "Las cotizaciones requieren el plan Profesional", code: "FEATURE_REQUIRED", feature: "cotizaciones_online" },
        { status: 403 }
      )
    }
```

(`NextResponse` ya está importado en el archivo.)

- [ ] **Step 4: Correr el test**

Run: `npx vitest run __tests__/api/cotizaciones-feature-gating.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/cotizaciones/route.ts __tests__/api/cotizaciones-feature-gating.test.ts
git commit -m "feat(planes): gatear creacion de cotizaciones por plan"
```

---

### Task 2: Gate en las otras 4 rutas de escritura + tests

**Files:**
- Modify: `app/api/cotizaciones/[id]/route.ts` (PUT)
- Modify: `app/api/cotizaciones/[id]/enviar/route.ts` (POST)
- Modify: `app/api/cotizaciones/[id]/duplicar/route.ts` (POST)
- Modify: `app/api/cotizacion-templates/route.ts` (POST)
- Test: `__tests__/api/cotizaciones-feature-gating.test.ts` (extender)

**Interfaces:**
- Consumes: mismo bloque de gate de Task 1.
- Produces: gating completo del feature set según la Global Constraint.

- [ ] **Step 1: Extender el test (casos que fallan)**

Agregar al final de `__tests__/api/cotizaciones-feature-gating.test.ts`, antes del cierre:

```typescript
import { PUT as editarCotizacion } from "@/app/api/cotizaciones/[id]/route"
import { POST as enviarCotizacion } from "@/app/api/cotizaciones/[id]/enviar/route"
import { POST as duplicarCotizacion } from "@/app/api/cotizaciones/[id]/duplicar/route"
import { POST as crearTemplate } from "@/app/api/cotizacion-templates/route"

const params = { params: Promise.resolve({ id: "cot-1" }) }

describe("gating — rutas de escritura restantes", () => {
  beforeEach(() => vi.clearAllMocks())

  it("PUT [id] → 403 sin feature", async () => {
    mockAuthSuccess()
    vi.mocked(hasPlanFeature).mockResolvedValueOnce(false)
    const res = await editarCotizacion(createPostRequest({ estado: "ENVIADA" }), params)
    const { status, body } = await parseResponse(res)
    expect(status).toBe(403)
    expect(body.feature).toBe("cotizaciones_online")
  })

  it("enviar → 403 sin feature", async () => {
    mockAuthSuccess()
    vi.mocked(hasPlanFeature).mockResolvedValueOnce(false)
    const res = await enviarCotizacion(createPostRequest({}), params)
    const { status } = await parseResponse(res)
    expect(status).toBe(403)
  })

  it("duplicar → 403 sin feature", async () => {
    mockAuthSuccess()
    vi.mocked(hasPlanFeature).mockResolvedValueOnce(false)
    const res = await duplicarCotizacion(createPostRequest({}), params)
    const { status } = await parseResponse(res)
    expect(status).toBe(403)
  })

  it("crear template → 403 sin feature", async () => {
    mockAuthSuccess()
    vi.mocked(hasPlanFeature).mockResolvedValueOnce(false)
    const res = await crearTemplate(createPostRequest({ nombre: "x", items: [] }))
    const { status } = await parseResponse(res)
    expect(status).toBe(403)
  })
})
```

- [ ] **Step 2: Correr para ver fallar**

Run: `npx vitest run __tests__/api/cotizaciones-feature-gating.test.ts`
Expected: FAIL en los 4 nuevos casos (rutas sin gate).

- [ ] **Step 3: Agregar el gate a las 4 rutas**

En CADA uno de estos archivos, agregar `import { hasPlanFeature } from "@/lib/subscriptions"` en la cabecera (si no está), y tras el bloque `const { error, organizationId, ... } = await requireAuth(); if (error) return error` insertar el MISMO bloque:

```typescript
    const hasCotizaciones = await hasPlanFeature(organizationId!, "cotizaciones_online")
    if (!hasCotizaciones) {
      return NextResponse.json(
        { error: "Las cotizaciones requieren el plan Profesional", code: "FEATURE_REQUIRED", feature: "cotizaciones_online" },
        { status: 403 }
      )
    }
```

Archivos y función:
- `app/api/cotizaciones/[id]/route.ts` → dentro de `export async function PUT` (tras su `requireAuth`, línea ~226). NO tocar GET ni DELETE.
- `app/api/cotizaciones/[id]/enviar/route.ts` → dentro de `POST` (tras `requireAuth`, línea ~13).
- `app/api/cotizaciones/[id]/duplicar/route.ts` → dentro de `POST` (tras `requireAuth`, línea ~12).
- `app/api/cotizacion-templates/route.ts` → dentro de `POST` (tras `requireAuth`). Confirmar que la función POST usa `requireAuth` y destructura `organizationId`; si el nombre difiere, adaptar.

Verificar que cada archivo importe `NextResponse` (todos devuelven `NextResponse.json`, así que ya está).

- [ ] **Step 4: Correr el test completo**

Run: `npx vitest run __tests__/api/cotizaciones-feature-gating.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: sin errores nuevos (ignorar el pre-existente `e2e/auth.setup.ts`).

- [ ] **Step 6: Commit**

```bash
git add app/api/cotizaciones/ app/api/cotizacion-templates/route.ts __tests__/api/cotizaciones-feature-gating.test.ts
git commit -m "feat(planes): gatear editar/enviar/duplicar cotizaciones y plantillas por plan"
```

---

## SLICE 2 — UI gating + landing (PR #2)

### Task 3: Gating de UI en la página de cotizaciones

**Files:**
- Modify: `app/(dashboard)/cotizaciones/page.tsx`

**Interfaces:**
- Consumes: `useHasFeature("cotizaciones_online")` de `@/hooks/use-subscription`.
- Produces: la UI oculta los puntos de creación cuando el org no tiene la feature; el backend (Slice 1) es la fuente de verdad.

- [ ] **Step 1: Importar el hook y derivar `canCrear`**

En `app/(dashboard)/cotizaciones/page.tsx`, agregar al bloque de imports:

```typescript
import { useHasFeature } from "@/hooks/use-subscription"
```

Dentro de `export default function CotizacionesPage()`, cerca del inicio (tras los `useState`), agregar:

```typescript
  const { hasFeature: canCrear } = useHasFeature("cotizaciones_online")
```

- [ ] **Step 2: Ocultar el botón "Nueva Cotización" y mostrar banner**

Reemplazar el `actions` del `PageShell` (líneas ~512-517) por:

```tsx
        actions={!showForm && !editingCotizacion && canCrear ? (
          <Button onClick={() => setShowTipoSelector(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Nueva Cotización
          </Button>
        ) : undefined}
```

Y justo debajo de la apertura de `<PageShell ...>` (antes del bloque `{/* Filters */}`), agregar el banner:

```tsx
      {!canCrear && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Las cotizaciones son parte del plan Profesional</p>
            <p className="text-xs text-muted-foreground">
              Podés seguir viendo y cerrando las que ya tenés. Para crear nuevas, pasate a Profesional.
            </p>
          </div>
          <Link href="/precios">
            <Button size="sm">Ver planes</Button>
          </Link>
        </div>
      )}
```

Agregar `import Link from "next/link"` en la cabecera si no está.

- [ ] **Step 3: Ocultar la acción de crear en el EmptyState**

En el `EmptyState` (línea ~675), cambiar el `action` para respetar `canCrear`:

```tsx
          action={!debouncedSearch && estadoFilter === "TODOS" && canCrear ? { label: "Nueva Cotización", onClick: () => setShowForm(true) } : undefined}
```

- [ ] **Step 4: Ocultar acciones de creación por fila (crear/editar/enviar/duplicar)**

En AMBAS vistas (lista y cards), envolver con `canCrear &&` los botones que llaman a rutas gateadas. Concretamente, cambiar las condiciones existentes:

- Editar: `canEdit && (` → `canEdit && canCrear && (` (vista lista línea ~745 y cards línea ~1009).
- Enviar: `canSend && (` → `canSend && canCrear && (` (línea ~755 y ~997).
- Duplicar: el botón de duplicar no tiene guard; envolverlo con `{canCrear && ( ... )}` (línea ~851 lista y ~1041 cards).
- Compartir por WhatsApp que fuerza `ENVIADA` (`handleShareWhatsApp`) y "Guardar como Plantilla" (`handleSaveAsTemplate`): envolver ambos con `canCrear &&` (líneas ~840/1113 WhatsApp, ~1124 Plantilla).

Dejar SIN tocar (siguen disponibles para cerrar/ver): PDF (`handleDownloadPDF`), Compartir link (`handleShare`), Aprobar (`setApprovingCotizacion`), Rechazar (`handleUpdateEstado ... RECHAZADA`), Convertir a venta (`setConvertingCotizacion`), Convertir a orden (`handleConvertirOrden`), Vincular a orden, Eliminar (`handleDelete`).

- [ ] **Step 5: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: sin errores nuevos en `page.tsx`.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/cotizaciones/page.tsx"
git commit -m "feat(planes): ocultar creacion de cotizaciones en Free con banner de upgrade"
```

---

### Task 4: Sync del landing (Free real)

**Files:**
- Modify: `components/landing/pricing-section.tsx` (array `plans`, líneas ~34-88)

**Interfaces:**
- Consumes: nada.
- Produces: el landing refleja la oferta post-flip.

- [ ] **Step 1: Actualizar la lista de features del plan Free**

Reemplazar el array `features` del objeto `name: "Free"` (líneas ~40-54) por:

```tsx
    features: [
      { text: "Hasta 30 órdenes/mes", included: true },
      { text: "1 técnico", included: true },
      { text: "Hasta 200 clientes", included: true },
      { text: "1 sucursal", included: true },
      { text: "Punto de venta (POS)", included: true },
      { text: "Portal de seguimiento", included: true },
      { text: "Inventario básico", included: true },
      { text: "100MB almacenamiento", included: true },
      { text: "Soporte por email", included: true },
      { text: "Cotizaciones online", included: false },
      { text: "Notificaciones WhatsApp", included: false },
      { text: "Reportes avanzados", included: false },
      { text: "Logo personalizado", included: false },
    ],
```

(Deja `cotizaciones_online`, WhatsApp, reportes y logo como el diferencial de Profesional; corrige el error histórico que mostraba POS y Portal como ✗.)

- [ ] **Step 2: Verificar que Profesional mantiene cotizaciones como diferencial**

Confirmar (sin cambios necesarios) que el objeto `name: "Profesional"` incluye `{ text: "Cotizaciones con aprobación online", included: true }` (línea ~71). Si el texto difiere, dejarlo como está — ya está incluido.

- [ ] **Step 3: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add components/landing/pricing-section.tsx
git commit -m "fix(landing): sincronizar features del plan Free con la oferta real"
```

---

## SLICE 3 — Migración + rollout (PR #3)

### Task 5: Migración 266 (el flip)

**Files:**
- Create: `supabase/migrations/266_free_v3_cotizaciones_gating.sql`

**Interfaces:**
- Produces: `free.feature_flags` sin `cotizaciones_online`; `free.features` (texto UI) actualizado; `pos_sales` y `client_portal` preservados.

- [ ] **Step 1: Escribir la migración**

```sql
-- ============================================================================
-- 266: Free v3 — cotizaciones pasan a Profesional
-- ============================================================================
-- Contexto: la 187 metió cotizaciones_online en Free y aplanó la escalera de
-- valor (conversión ~0%). Este cambio devuelve SOLO cotizaciones_online a
-- Profesional. POS (pos_sales) y seguimiento (client_portal) quedan en Free.
--
-- El enforcement vive en el código (guard hasPlanFeature en las rutas de
-- creación). Esta migración apaga el flag; correr en el "día del flip", después
-- del aviso a los usuarios. NO toca precios, status ni suscripciones.
-- ============================================================================

BEGIN;

UPDATE plans SET
  feature_flags = feature_flags - 'cotizaciones_online',
  features = '["Hasta 30 órdenes/mes","1 técnico","1 vendedor","Hasta 200 clientes","100MB almacenamiento","Punto de venta (POS)","Portal de seguimiento cliente","Inventario básico","Soporte por email"]'::jsonb,
  updated_at = now()
WHERE slug = 'free';

COMMIT;
```

- [ ] **Step 2: Verificar que preserva los otros flags**

Run: `rg -n "pos_sales|client_portal" supabase/migrations/266_free_v3_cotizaciones_gating.sql`
Expected: sin coincidencias — la migración solo remueve `cotizaciones_online`, no menciona los otros (se preservan porque `-` quita una sola clave).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/266_free_v3_cotizaciones_gating.sql
git commit -m "feat(planes): migracion free v3 — cotizaciones a Profesional"
```

---

### Task 6: Banner de transición (aviso in-app)

**Files:**
- Create: `components/cotizaciones/cotizaciones-upgrade-banner.tsx`
- Modify: `app/(dashboard)/cotizaciones/page.tsx` (usar el banner extraído — opcional si ya quedó inline en Task 3)

**Interfaces:**
- Consumes: nada (componente presentacional).
- Produces: `<CotizacionesUpgradeBanner />` reutilizable.

> Nota de rollout: el **email de aviso** a los orgs Free con cotizaciones se envía **manualmente** desde `app/superadmin/broadcast` (no requiere código nuevo). Este task solo cubre el banner in-app, que ya se muestra vía `canCrear` (Task 3). Si el banner inline de Task 3 alcanza, este task es OPCIONAL (extraer a componente para reutilizar en otras vistas).

- [ ] **Step 1: Extraer el banner a un componente**

```tsx
// components/cotizaciones/cotizaciones-upgrade-banner.tsx
import Link from "next/link"
import { Button } from "@/components/ui/button"

export function CotizacionesUpgradeBanner() {
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium">Las cotizaciones son parte del plan Profesional</p>
        <p className="text-xs text-muted-foreground">
          Podés seguir viendo y cerrando las que ya tenés. Para crear nuevas, pasate a Profesional.
        </p>
      </div>
      <Link href="/precios">
        <Button size="sm">Ver planes</Button>
      </Link>
    </div>
  )
}
```

- [ ] **Step 2: Usarlo en la página**

En `app/(dashboard)/cotizaciones/page.tsx`, reemplazar el JSX inline del banner (Task 3 Step 2) por `{!canCrear && <CotizacionesUpgradeBanner />}` y agregar el import. (Si preferís mantenerlo inline, saltear este task.)

- [ ] **Step 3: Typecheck + commit**

Run: `./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: sin errores.

```bash
git add components/cotizaciones/cotizaciones-upgrade-banner.tsx "app/(dashboard)/cotizaciones/page.tsx"
git commit -m "refactor(planes): extraer banner de upgrade de cotizaciones"
```

---

## Rollout (operativo, fuera del código)

1. Mergear PR #1 (backend gating) y PR #2 (UI + landing) — **sin correr la migración 266**. El flag sigue TRUE para Free → sin cambio de comportamiento (las rutas gatean por `hasPlanFeature`, que lee el flag aún prendido).
2. **Aviso (~14 días):** enviar broadcast desde `app/superadmin/broadcast` a orgs Free con cotizaciones + el banner in-app ya visible para quien no tiene la feature (aparece recién tras el flip).
3. **Día del flip:** aplicar la migración 266 en Supabase → el gating se activa (Free pierde crear cotizaciones; conserva ver/cerrar).

---

## Self-Review (cobertura vs spec)

- **Enforcement backend (§1 del spec)** → Task 1 (POST) + Task 2 (PUT/enviar/duplicar/templates). Rutas NO gateadas (GET/aprobar/convertir/públicas) explícitamente excluidas. ✅
- **Enforcement UI (§2)** → Task 3 (banner + ocultar creación/edición/envío/duplicado, dejar cierre). ✅
- **Migración (§3)** → Task 5 (quita solo `cotizaciones_online`, preserva pos_sales/client_portal, actualiza features text). ✅
- **Sync landing (§4)** → Task 4. ✅
- **Aviso de transición (§5)** → Task 6 (banner) + email manual vía broadcast (nota de rollout). ✅
- **Históricos read-only + close-out** → Task 2 no gatea aprobar/convertir; Task 3 deja esos botones. ✅
- **Override por org** → lo maneja `hasPlanFeature` (sin código nuevo). ✅

**Placeholders:** ninguno — todo el código está completo. Las referencias a líneas (`~226`, etc.) van con la instrucción de insertar tras `requireAuth`, con el ancla textual exacta.

**Consistencia de tipos:** el bloque de gate (`hasPlanFeature(organizationId!, "cotizaciones_online")` + 403 shape) es idéntico en Task 1 y Task 2; `useHasFeature("cotizaciones_online")` → `canCrear` en Task 3.

## Notas de entrega

- **3 PRs**: #1 backend (deploy-safe), #2 UI+landing, #3 migración+banner. La migración se aplica manualmente el día del flip, no al mergear.
- **Riesgo**: olvidar una ruta de creación → la tabla de Global Constraints es la checklist; el test de gating cubre las 5 rutas.
