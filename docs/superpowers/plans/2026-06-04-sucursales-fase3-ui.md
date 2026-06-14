# Sucursales — Fase 3: UI (switcher + ABM + selector + gating) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) o superpowers:executing-plans. Steps usan checkbox (`- [ ]`).

**Goal:** Dar UI a multi-sucursal: ABM de sucursales (gateado por plan), switcher de sucursal activa para ADMIN, selector de sucursal en alta de técnico/vendedor, e indicador de sucursal en listados cuando el admin ve "todas".

**Architecture:** Clonar el feature `depositos` (mismo shape: principal/soft-delete/CRUD) para la API y la página ABM. El switcher setea la cookie `stapp-sucursal-activa` vía una API route nueva. El gating reusa `enforcePlanLimit` extendido con `'sucursales'` (el DB `check_plan_limit('sucursales')` ya existe, mig 204). Helpers de `lib/sucursal.ts` (Fase 2) ya disponibles.

**Tech Stack:** Next.js App Router (client components con `useSession`), Supabase service-role, shadcn/ui (Dialog, DropdownMenu, Select, Switch, Badge), vitest.

**Worktree:** Trabajar en `C:\Users\LUIS\Desktop\stapp-sucursales` (branch `feat/sistema-sucursales`). NO tocar `C:\Users\LUIS\Desktop\stapp` (rama landing del usuario).

---

## Contexto previo (leer antes de empezar)

- **Molde `depositos`** (clonar casi 1:1):
  - API: `app/api/depositos/route.ts` (GET lista + POST crea), `app/api/depositos/[id]/route.ts` (PUT + DELETE soft).
  - Página ABM: `app/(dashboard)/configuracion/depositos/page.tsx` (client component, todo-en-uno: lista + dialog crear/editar + archivar).
  - Diferencia: depositos bloquea DELETE si tiene stock (`inventario_depositos`). Sucursales bloquea DELETE si es principal o si tiene órdenes/usuarios.
- **Helpers `lib/sucursal.ts`** (Fase 2): `SUCURSAL_COOKIE`, `getCookieSucursalId()`, `assertSucursalEnOrg(sucursalId, orgId)`, `sucursalParaEscritura()`, `sucursalParaLectura()`.
- **Gating**: `lib/plan-limits.ts` → `enforcePlanLimit(orgId, limitType)` retorna `NextResponse|null`. Llama a `checkPlanLimit` de `lib/subscriptions.ts`. El DB `check_plan_limit(org,'sucursales')` ya hace COUNT en vivo vs `plans.limite_sucursales` (FREE=1, Profesional=3, Pro=NULL).
- **Sesión**: `session.user.sucursalId` y `session.user.role` disponibles (Fase 2). `useSession()` en client.
- **Forms de usuario**: `components/tecnicos/tecnico-form.tsx`, `components/vendedores/vendedor-form.tsx` (Dialog, POST/PUT a `/api/tecnicos` y `/api/vendedores`).
- **Navbar**: `components/layout/navbar.tsx` (client, `useSession`). Zona desktop top-right ~líneas 475-530 (junto a NotificationBell/ThemeToggle); zona mobile ~574-634 (tras PlanBadge).
- **Tests**: vitest con Supabase mockeado. CORRER SIEMPRE con `--pool=vmThreads` (el pool default está roto en este entorno: Node 24 + vitest 4 → "No test suite found").

## File Structure

- Modify: `lib/subscriptions.ts` — `checkPlanLimit` acepta `'sucursales'` (límite + COUNT en vivo).
- Modify: `lib/plan-limits.ts` — `LimitType` += `'sucursales'` + entrada en `LIMIT_MESSAGES`.
- Create: `app/api/sucursales/route.ts` — GET lista + POST crea (con gate).
- Create: `app/api/sucursales/[id]/route.ts` — PUT + DELETE (soft).
- Create: `app/api/sucursales/set-activa/route.ts` — setea cookie de sucursal activa.
- Create: `components/layout/sucursal-switcher.tsx` — dropdown switcher (ADMIN).
- Modify: `components/layout/navbar.tsx` — montar `<SucursalSwitcher/>`.
- Create: `app/(dashboard)/configuracion/sucursales/page.tsx` — ABM (clon de depositos).
- Modify: `components/tecnicos/tecnico-form.tsx` + `components/vendedores/vendedor-form.tsx` — selector de sucursal.
- Modify: `app/api/tecnicos/route.ts` + `app/api/vendedores/route.ts` — aceptar `sucursalId` del body (validado).
- Modify: `components/ordenes/ordenes-list.tsx` + `app/api/ordenes/route.ts` — badge/columna de sucursal en modo "todas" (Task final, deferible).

---

### Task 1: Gating de plan para sucursales

**Files:**
- Modify: `lib/subscriptions.ts`
- Modify: `lib/plan-limits.ts`

- [ ] **Step 1: `lib/subscriptions.ts` — incluir `limite_sucursales` en el select y en `limits`**

En `getSubscriptionInfo`, agregar `limite_sucursales,` al select de columnas de `plans` (junto a `limite_vendedores,` ~línea 69) y agregar al objeto `limits` (~línea 98-103):
```typescript
      sucursales: plan.limite_sucursales,
```

- [ ] **Step 2: `lib/subscriptions.ts` — ampliar la firma y el switch de `checkPlanLimit`**

Cambiar el tipo del parámetro `limitType` (~línea 181) a incluir `"sucursales"`:
```typescript
  limitType: "ordenes" | "tecnicos" | "clientes" | "vendedores" | "storage" | "sucursales"
```
Agregar el caso al switch del bloque `if (subscription)` (~línea 204) y también al bloque `else` (FREE). Como `sucursales_count` en `organization_usage` no se mantiene por trigger, usar COUNT en vivo. Agregar después del switch de subscription (o como caso dedicado que sobreescribe `current`):
```typescript
      case "sucursales": {
        limit = subscription.limits.sucursales
        const { count } = await supabaseAdmin
          .from("sucursales")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .is("deleted_at", null)
          .eq("activo", true)
        current = count ?? 0
        break
      }
```
En el bloque `else` (sin suscripción), `limit = FREE_PLAN_LIMITS.sucursales` y el mismo COUNT en vivo para `current`. Agregar `sucursales: 1` a `FREE_PLAN_LIMITS` (buscar la constante en el archivo). Agregar `sucursales: "sucursales"` al `limitLabels` (~línea 267).

- [ ] **Step 3: `lib/plan-limits.ts` — `LimitType` + mensaje**

Cambiar (~línea 4):
```typescript
export type LimitType = "ordenes" | "tecnicos" | "clientes" | "vendedores" | "storage" | "sucursales"
```
Agregar a `LIMIT_MESSAGES`:
```typescript
  sucursales: {
    title: "Límite de sucursales alcanzado",
    description: "Alcanzaste el límite de sucursales de tu plan.",
    action: "Subí a Pro para crear sucursales ilimitadas.",
  },
```

- [ ] **Step 4: Verificar typecheck**

Run: `npx tsc --noEmit` → sin errores nuevos.

- [ ] **Step 5: Commit**

```bash
git add lib/subscriptions.ts lib/plan-limits.ts
git commit -m "feat(sucursales): gating de plan para sucursales (checkPlanLimit + enforcePlanLimit)"
```

---

### Task 2: API CRUD de sucursales

**Files:**
- Create: `app/api/sucursales/route.ts`
- Create: `app/api/sucursales/[id]/route.ts`
- Test: `__tests__/api/sucursales.test.ts`

- [ ] **Step 1: `app/api/sucursales/route.ts` (clonar `app/api/depositos/route.ts`)**

Copiar el contenido de `app/api/depositos/route.ts` y transformar:
- Renombrar `formatDeposito` → `formatSucursal`; tabla `"depositos"` → `"sucursales"`; mensajes "depósito"→"sucursal".
- Agregar `telefono` al `createSchema` y al `formatSucursal` (sucursales tiene `telefono`, depositos no):
  ```typescript
  telefono: z.string().trim().max(40).nullable().optional(),
  ```
  y en formatSucursal: `telefono: row.telefono ?? null,`, y en el `.insert({...})`: `telefono: data.telefono ?? null,`.
- En el POST, ANTES de la lógica de demote/insert, agregar el gate de plan:
  ```typescript
  import { enforcePlanLimit } from "@/lib/plan-limits"
  // ...dentro de POST, tras requireAdmin:
  const limitError = await enforcePlanLimit(organizationId!, "sucursales")
  if (limitError) return limitError
  ```

- [ ] **Step 2: `app/api/sucursales/[id]/route.ts` (clonar `app/api/depositos/[id]/route.ts`)**

Copiar y transformar igual (nombres/tabla/mensajes + `telefono`). CAMBIO en el DELETE: reemplazar el bloque de "bloquear si tiene stock" (`inventario_depositos`) por bloqueo si la sucursal tiene órdenes o usuarios asignados:
```typescript
    // Bloquear archivado si la sucursal tiene órdenes o usuarios asignados.
    const [{ count: ordenesCount }, { count: usersCount }] = await Promise.all([
      supabaseAdmin.from("ordenes_servicio").select("id", { count: "exact", head: true })
        .eq("sucursal_id", id),
      supabaseAdmin.from("users").select("id", { count: "exact", head: true })
        .eq("sucursal_id", id),
    ])
    if ((ordenesCount ?? 0) > 0 || (usersCount ?? 0) > 0) {
      return NextResponse.json(
        {
          error: "La sucursal tiene órdenes o personal asignado. Reasigná antes de archivar, o desactivala.",
          code: "HAS_DATA",
        },
        { status: 409 }
      )
    }
```
Mantener: bloqueo de archivar/despromover/desactivar la principal (igual que depositos).

- [ ] **Step 3: Test del POST (gate + create)**

Crear `__tests__/api/sucursales.test.ts`. Casos:
1. 401 sin auth.
2. POST crea sucursal: mock `enforcePlanLimit`-path. Como enforcePlanLimit llama a checkPlanLimit (que consulta supabase), es más simple mockear las tablas que toca (`subscriptions`/`plans` vía getSubscriptionInfo, `sucursales` count) para que `allowed=true`, y `sucursales` insert con spy. Si el grafo de mocks es complejo, alternativamente extraer el assert sobre que el INSERT a `sucursales` recibe `{ organization_id, nombre, activo: true }`. Seguir el patrón de `__tests__/api/ordenes.test.ts`.
3. POST bloqueado por plan: mockear de modo que el COUNT de sucursales ≥ limit → 403 con `code: "PLAN_LIMIT_EXCEEDED"`.

Ajustar mocks a la realidad (mirar cómo otros tests mockean subscriptions/plans). Lo esencial: que un caso valide creación OK y otro valide el 403 del gate.

- [ ] **Step 4: Correr tests + typecheck**

```
npx vitest run __tests__/api/sucursales.test.ts --pool=vmThreads
npx tsc --noEmit
```
Esperado: PASS + sin errores.

- [ ] **Step 5: Commit**

```bash
git add app/api/sucursales/route.ts app/api/sucursales/[id]/route.ts __tests__/api/sucursales.test.ts
git commit -m "feat(sucursales): API CRUD de sucursales (gate por plan + soft-delete)"
```

---

### Task 3: API set-activa (cookie de sucursal activa)

**Files:**
- Create: `app/api/sucursales/set-activa/route.ts`
- Test: `__tests__/api/sucursales-set-activa.test.ts`

- [ ] **Step 1: Escribir la route**

Crear `app/api/sucursales/set-activa/route.ts`:
```typescript
import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { requireAuth } from "@/lib/auth-utils"
import { assertSucursalEnOrg, SUCURSAL_COOKIE } from "@/lib/sucursal"
import { z } from "zod"

const schema = z.object({
  // "todas" => limpia el filtro (admin ve todas); un id => fija esa sucursal.
  sucursalId: z.string().min(1),
})

export async function POST(request: Request) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    // Solo ADMIN cambia de sucursal activa; el resto está atado a la suya.
    if (role !== "ADMIN") {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
    }

    const body = await request.json()
    const { sucursalId } = schema.parse(body)

    if (sucursalId !== "todas") {
      const ok = await assertSucursalEnOrg(sucursalId, organizationId!)
      if (!ok) {
        return NextResponse.json({ error: "Sucursal inválida" }, { status: 400 })
      }
    }

    const store = await cookies()
    store.set(SUCURSAL_COOKIE, sucursalId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365,
    })

    return NextResponse.json({ success: true, sucursalId })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error set sucursal activa:", err)
    return NextResponse.json({ error: "Error al cambiar de sucursal" }, { status: 500 })
  }
}
```

- [ ] **Step 2: Test**

Crear `__tests__/api/sucursales-set-activa.test.ts`. Casos: (a) no-admin → 403; (b) admin con sucursalId válido (mock `sucursales` para assertSucursalEnOrg) → 200 + success; (c) "todas" → 200 sin validar DB. Mockear `cookies()` ya está en `vitest.setup.ts`.

- [ ] **Step 3: Correr tests + typecheck**

```
npx vitest run __tests__/api/sucursales-set-activa.test.ts --pool=vmThreads
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add app/api/sucursales/set-activa/route.ts __tests__/api/sucursales-set-activa.test.ts
git commit -m "feat(sucursales): API set-activa setea cookie de sucursal (solo ADMIN)"
```

---

### Task 4: SucursalSwitcher en navbar (ADMIN)

**Files:**
- Create: `components/layout/sucursal-switcher.tsx`
- Modify: `components/layout/navbar.tsx`

- [ ] **Step 1: Componente switcher**

Crear `components/layout/sucursal-switcher.tsx`:
```tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { Store, Check, ChevronsUpDown } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface Sucursal {
  id: string
  nombre: string
  principal: boolean
}

const TODAS = "todas"

export function SucursalSwitcher() {
  const { data: session } = useSession()
  const router = useRouter()
  const isAdmin = session?.user?.role === "ADMIN"

  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [activa, setActiva] = useState<string>(TODAS)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isAdmin) return
    fetch("/api/sucursales")
      .then((r) => r.json())
      .then((d) => setSucursales(d.data || []))
      .catch(() => {})
    // Leer cookie actual (no httpOnly-readable desde client → default 'todas';
    // el server respeta la cookie real igualmente). Para reflejar selección,
    // guardamos en localStorage como espejo de UI.
    const mirror = typeof window !== "undefined" ? window.localStorage.getItem("sucursal-activa-ui") : null
    if (mirror) setActiva(mirror)
  }, [isAdmin])

  if (!isAdmin) return null
  // Sin multi-sucursal (solo la principal), no mostrar el switcher.
  if (sucursales.length <= 1) return null

  const seleccionar = async (id: string) => {
    setSaving(true)
    try {
      const res = await fetch("/api/sucursales/set-activa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sucursalId: id }),
      })
      if (res.ok) {
        setActiva(id)
        if (typeof window !== "undefined") window.localStorage.setItem("sucursal-activa-ui", id)
        router.refresh()
      }
    } finally {
      setSaving(false)
    }
  }

  const label =
    activa === TODAS
      ? "Todas las sucursales"
      : sucursales.find((s) => s.id === activa)?.nombre ?? "Sucursal"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          <Store className="h-4 w-4 text-muted-foreground" />
          <span className="max-w-[140px] truncate">{label}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Sucursal activa</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => seleccionar(TODAS)}>
          <Check className={`mr-2 h-4 w-4 ${activa === TODAS ? "opacity-100" : "opacity-0"}`} />
          Todas las sucursales
        </DropdownMenuItem>
        {sucursales.map((s) => (
          <DropdownMenuItem key={s.id} onClick={() => seleccionar(s.id)}>
            <Check className={`mr-2 h-4 w-4 ${activa === s.id ? "opacity-100" : "opacity-0"}`} />
            <span className="truncate">{s.nombre}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

> Nota: la cookie es httpOnly (no legible en client), por eso usamos un espejo en localStorage solo para reflejar la selección en la UI. El server siempre lee la cookie real (fuente de verdad). El `router.refresh()` re-fetcha los server components/listados con el nuevo filtro.

- [ ] **Step 2: Montar en navbar**

En `components/layout/navbar.tsx`, importar `import { SucursalSwitcher } from "@/components/layout/sucursal-switcher"`. En la zona desktop top-right (junto a `NotificationBell`/`ThemeToggle`, ~línea 482-484) insertar `<SucursalSwitcher />` antes de `<ThemeToggle />`. (El componente se auto-oculta si no es admin o hay ≤1 sucursal, así que es seguro montarlo siempre.)

- [ ] **Step 3: Verificar build/typecheck**

Run: `npx tsc --noEmit` → sin errores. Confirmar que existe `components/ui/dropdown-menu.tsx` con los exports usados (DropdownMenu, Trigger, Content, Item, Label, Separator); si algún export falta, ajustar imports a los disponibles.

- [ ] **Step 4: Commit**

```bash
git add components/layout/sucursal-switcher.tsx components/layout/navbar.tsx
git commit -m "feat(sucursales): SucursalSwitcher en navbar (ADMIN, multi-sucursal)"
```

---

### Task 5: Página ABM de sucursales

**Files:**
- Create: `app/(dashboard)/configuracion/sucursales/page.tsx`

- [ ] **Step 1: Clonar la página de depósitos**

Copiar `app/(dashboard)/configuracion/depositos/page.tsx` a `app/(dashboard)/configuracion/sucursales/page.tsx` y transformar:
- Endpoints `/api/depositos` → `/api/sucursales`.
- Textos "Depósito(s)" → "Sucursal(es)"; "depósito" → "sucursal".
- Agregar campo `telefono` al form (input opcional, junto a dirección), enviarlo en POST/PUT y mostrarlo en la lista.
- Quitar cualquier copy específico de stock/inventario.
- En `handleSave`, manejar el 403 de plan: si `res.status === 403` y el body trae `code: "PLAN_LIMIT_EXCEEDED"`, mostrar el mensaje del body (`data.error`) en el `error` state (CTA "Subí a Pro"). No romper el flujo.
- En `handleArchive`, manejar el 409 `code: "HAS_DATA"`: mostrar el `data.error` (sugerir desactivar en vez de archivar).

- [ ] **Step 2: Verificar que la ruta existe en el menú de configuración**

Buscar el índice de configuración (`app/(dashboard)/configuracion/page.tsx` o el componente que lista las secciones) y agregar una tarjeta/enlace a `/configuracion/sucursales` (ícono `Store`), siguiendo el patrón del enlace a `/configuracion/depositos`. Si depositos no está en un índice (se accede por URL directa), omitir este step.

- [ ] **Step 3: Verificar typecheck/build**

Run: `npx tsc --noEmit` → sin errores.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/configuracion/sucursales/page.tsx"
git add -A app/\(dashboard\)/configuracion
git commit -m "feat(sucursales): pagina ABM de sucursales (clon de depositos + gate UI)"
```

---

### Task 6: Selector de sucursal en alta de técnico/vendedor

**Files:**
- Modify: `app/api/tecnicos/route.ts` + `app/api/vendedores/route.ts` (aceptar `sucursalId` del body)
- Modify: `components/tecnicos/tecnico-form.tsx` + `components/vendedores/vendedor-form.tsx`

- [ ] **Step 1: API acepta `sucursalId` explícito (validado)**

Hoy ambos POST resuelven `sucursalId` vía `sucursalParaEscritura` (sucursal activa del admin). Permitir que el form mande una sucursal explícita: si viene `body.sucursalId` y `assertSucursalEnOrg` lo valida, usarlo; si no, caer al default actual.

En `app/api/tecnicos/route.ts` POST (y análogo en vendedores), tras parsear el body:
```typescript
import { assertSucursalEnOrg } from "@/lib/sucursal"
// ...
let sucursalId = await sucursalParaEscritura({
  role,
  organizationId: organizationId!,
  userSucursalId: session!.user.sucursalId ?? null,
})
const bodySucursalId = (body?.sucursalId ?? null) as string | null
if (bodySucursalId && (await assertSucursalEnOrg(bodySucursalId, organizationId!))) {
  sucursalId = bodySucursalId
}
```
(En vendedores el body es `data` validado por zod — agregar `sucursalId: z.string().optional()` al `vendedorCreateSchema` y leer `data.sucursalId`.)

- [ ] **Step 2: Selector en los forms**

En `components/tecnicos/tecnico-form.tsx` y `components/vendedores/vendedor-form.tsx`:
- Agregar state `sucursalId` y fetch de `/api/sucursales` al abrir (lista de activas).
- Renderizar un `<select>` (o el `Select` de shadcn si el form ya lo usa) "Sucursal" con las opciones; default la primera/principal.
- Incluir `sucursalId` en el body del POST/PUT.
- Mostrar el selector solo si hay >1 sucursal (si solo hay Casa Central, omitir — queda el default del backend).

- [ ] **Step 3: Verificar typecheck**

Run: `npx tsc --noEmit` → sin errores nuevos. Correr los tests de tecnicos/vendedores si existen: `npx vitest run __tests__/api/ --pool=vmThreads` (o los archivos puntuales) y confirmar que no hay regresión.

- [ ] **Step 4: Commit**

```bash
git add app/api/tecnicos/route.ts app/api/vendedores/route.ts components/tecnicos/tecnico-form.tsx components/vendedores/vendedor-form.tsx
git commit -m "feat(sucursales): selector de sucursal en alta de tecnico/vendedor"
```

---

### Task 7 (deferible): Columna/badge de sucursal en listados

**Files:**
- Modify: `app/api/ordenes/route.ts` (GET devuelve nombre de sucursal)
- Modify: `components/ordenes/ordenes-list.tsx` (columna/badge cuando admin ve "todas")

> Esta task es de pulido y se puede diferir sin bloquear el resto. Solo aporta valor visual cuando existen 2+ sucursales y el admin está en modo "todas".

- [ ] **Step 1: GET de órdenes devuelve la sucursal**

En `app/api/ordenes/route.ts` GET, agregar el join al select para traer el nombre de la sucursal (patrón de los otros joins del select, ej. `sucursal:sucursales(id, nombre)`), y mapear `sucursalNombre` en la respuesta.

- [ ] **Step 2: Mostrar la sucursal en la lista**

En `components/ordenes/ordenes-list.tsx`, agregar una columna/badge "Sucursal" que se muestre solo cuando el usuario es ADMIN y está viendo "todas" (sin sucursal activa). Usar `<Badge variant="outline">{orden.sucursalNombre}</Badge>`.

- [ ] **Step 3: Verificar typecheck + commit**

```
npx tsc --noEmit
git add app/api/ordenes/route.ts components/ordenes/ordenes-list.tsx
git commit -m "feat(sucursales): badge de sucursal en listado de ordenes (modo todas)"
```

---

## Self-Review

**Cobertura del spec (Sección 4 UI):**
- Switcher de sucursal (ADMIN, cookie) → Tasks 3 + 4. ✓
- ABM sucursales con gate por plan → Tasks 1 + 2 + 5. ✓
- No borrar principal / no borrar con datos → Task 2 Step 2. ✓
- Selector de sucursal en alta de usuario → Task 6. ✓
- Badge de sucursal en listados (modo todas) → Task 7 (deferible). ✓
- TECNICO/VENDEDOR ven badge fijo, no switcher → el switcher se auto-oculta (no admin) — el badge fijo de su sucursal es pulido menor, no incluido (no crítico).

**Placeholders:** Tasks 2 y 5 son clones con transformaciones puntuales explícitas (no reproducen el archivo fuente entero, pero las transformaciones son completas y verificables contra el original). Net-new (switcher, set-activa, gating) tienen código completo.

**Consistencia:** `SUCURSAL_COOKIE`, `assertSucursalEnOrg`, `enforcePlanLimit('sucursales')`, `formatSucursal` usados consistentes. Endpoints `/api/sucursales*` consistentes entre switcher, ABM y forms.

**Riesgos:**
- Gate de plan: `checkPlanLimit('sucursales')` usa COUNT en vivo (no el contador cacheado, que no tiene trigger) → sin drift.
- Cookie httpOnly no legible en client → se usa espejo en localStorage solo para UI; la fuente de verdad sigue siendo la cookie server-side.
- El switcher se auto-oculta con ≤1 sucursal → cero cambio visible hasta que se cree la 2da (coherente con el rollout invisible).

## Pendientes de Fase 2 que siguen vigentes
- Aplicar migración **206** (`crear_venta_atomica` + `p_sucursal_id`) en Supabase ANTES de deployar el código (Fase 2/3 ya pasa `p_sucursal_id`).
- Aplicar migración **207** (`SET NOT NULL`) DESPUÉS del deploy.
- Fase 4 (billing): activar plan PRO (`activo=true`), price IDs Stripe/MP, pricing landing.
