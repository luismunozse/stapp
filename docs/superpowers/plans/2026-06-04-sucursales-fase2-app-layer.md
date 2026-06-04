# Sucursales — Fase 2: App-Layer (sesión + helper + scoping) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la sesión lleve `sucursalId`, exista un helper central de resolución de sucursal, y que la creación y lectura de órdenes/ventas/caja/usuarios respeten la sucursal — sin UI todavía y sin regresión para orgs de una sola sucursal.

**Architecture:** Enforcement app-layer (servicio service-role filtra/escribe `sucursal_id`, espejo del patrón `organization_id`). Lógica de resolución concentrada en `lib/sucursal.ts` (funciones puras testeables + un wrapper server). Las RPC de dinero (ventas) se tocan con cuidado. El `SET NOT NULL` (diferido de Fase 1) se aplica al final, recién cuando el código ya escribe `sucursal_id`.

**Tech Stack:** Next.js App Router, NextAuth v5 (JWT), Supabase (PostgreSQL, service-role), vitest (tests de API con Supabase mockeado, ver `__tests__/api/helpers.ts`).

---

## Contexto previo (leer antes de empezar)

- **Resolución de sucursal (regla de negocio):**
  - `TECNICO` / `VENDEDOR`: atados a `users.sucursal_id` (fijo). Ven y escriben solo su sucursal.
  - `ADMIN`: `users.sucursal_id = NULL`. Ve "todas" por defecto (sin filtro). Para escribir usa la **sucursal activa** (cookie `stapp-sucursal-activa`, que recién setea la Fase 3 UI); mientras no haya cookie, default = sucursal **principal** (Casa Central).
- **Sin regresión:** post-backfill de Fase 1, toda la data vive en la Casa Central de cada org. Filtrar a un técnico por su sucursal = sigue viendo todo (todo está en Casa Central). El admin ve todas. Comportamiento idéntico al actual hasta que existan 2+ sucursales (Fase 3).
- **Helper de auth existente:** `lib/auth-utils.ts` → `requireAuth()` devuelve `{ error, session, organizationId, userId, role }`. `getAuthSession()` lee de `auth()`. La sesión ya expone `session.user.organizationId`, `.role`, `.id`.
- **Sesión NextAuth:** `lib/auth.ts` (callbacks `jwt`/`session`, 3 modos de `authorize`), tipos en `types/next-auth.d.ts`.
- **Tests:** mockean `auth()` (`mockAuthSuccess({ organizationId, userId, role })`) y `supabaseAdmin.from()` (`mockSupabaseFrom`). Ver `__tests__/api/helpers.ts`. Las funciones puras de `lib/sucursal.ts` se testean directo sin mocks.
- **RPC de ventas:** `crear_venta_atomica` — definición vigente en `supabase/migrations/200_series_en_venta_e_idempotencia.sql` (redefinida varias veces; usar SIEMPRE la última). Modificar su firma exige DROP del signature viejo (Postgres identifica funciones por nombre+tipos; ya hubo bug de overload, ver mig 055).

## File Structure

- Modify: `types/next-auth.d.ts` — `sucursalId` en Session.user, User, JWT.
- Modify: `lib/auth.ts` — select `sucursal_id`, poblar en los 3 returns de authorize + callbacks jwt/session.
- Create: `lib/sucursal.ts` — resolución pura + wrapper server + `assertSucursalEnOrg`.
- Create: `lib/__tests__/sucursal.test.ts` — tests de las funciones puras.
- Modify: `app/api/ordenes/route.ts` — INSERT con `sucursal_id`; GET con filtro.
- Modify: `app/api/ventas/route.ts` — pasar `p_sucursal_id` a la RPC; GET con filtro.
- Create: `supabase/migrations/206_crear_venta_atomica_sucursal.sql` — RPC con `p_sucursal_id`.
- Modify: `app/api/caja/sesiones/route.ts` — INSERT con `sucursal_id`; GET con filtro.
- Modify: `app/api/caja/movimientos/route.ts` — INSERT con `sucursal_id`; GET con filtro.
- Modify: `app/api/tecnicos/route.ts` + `app/api/vendedores/route.ts` — INSERT users con `sucursal_id`.
- Create: `supabase/migrations/207_sucursales_set_not_null.sql` — `SET NOT NULL` (aplicar SOLO tras deploy del código de esta fase).

---

### Task 1: Sesión lleva `sucursalId`

**Files:**
- Modify: `types/next-auth.d.ts`
- Modify: `lib/auth.ts` (select de users + 3 returns de `authorize` + callbacks `jwt`/`session`)

- [ ] **Step 1: Augmentar los tipos**

En `types/next-auth.d.ts`, agregar `sucursalId` a las tres interfaces. Reemplazar el bloque completo:

```typescript
import { DefaultSession } from "next-auth"

type Rol = "ADMIN" | "TECNICO" | "VENDEDOR"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      role: Rol
      organizationId: string
      sucursalId: string | null
      isSuperadmin?: boolean
      avatar?: string | null
    } & DefaultSession["user"]
    error?: string
  }

  interface User {
    role: Rol
    organizationId: string
    sucursalId?: string | null
    isSuperadmin?: boolean
    rememberMe?: boolean
    refreshToken?: string
    avatar?: string | null
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: Rol
    id: string
    organizationId: string
    sucursalId?: string | null
    isSuperadmin?: boolean
    rememberMe?: boolean
    refreshToken?: string
    avatar?: string | null
    error?: string
  }
}
```

- [ ] **Step 2: Seleccionar `sucursal_id` en las queries de users de `authorize`**

En `lib/auth.ts`, las 3 ramas de `authorize` seleccionan datos de `users`. Agregar `sucursal_id` al select:
- Modo PWA (refresh token): el select de `fullUser` (alrededor de línea 147-158) — agregar `sucursal_id,` después de `organization_id,`.
- Modo Google y Modo password usan `select("*", ...)` (líneas ~202 y ~286) → ya traen `sucursal_id`, no requieren cambio.

- [ ] **Step 3: Poblar `sucursalId` en los 3 returns de `authorize`**

En cada uno de los 3 `return { ... }` de `authorize` (líneas ~179, ~259, ~411), agregar después de `organizationId: ...`:

```typescript
        sucursalId: (fullUser.sucursal_id ?? null),
```

(En el modo PWA la variable es `fullUser`; en Google es `gUser`; en password es `user`. Usar la variable correcta de cada rama: `gUser.sucursal_id`, `user.sucursal_id`.)

- [ ] **Step 4: Propagar en los callbacks `jwt` y `session`**

En el callback `jwt`, dentro del bloque de login inicial (`if (user && user.id)`, ~línea 428), agregar:

```typescript
        token.sucursalId = user.sucursalId ?? null
```

En el callback `session` (`if (session.user)`, ~línea 511), agregar:

```typescript
        session.user.sucursalId = (token.sucursalId as string | null) ?? null
```

- [ ] **Step 5: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos relacionados a `sucursalId`. (Si el proyecto no tiene script de typecheck aislado, usar `npm run build` y confirmar que compila.)

- [ ] **Step 6: Commit**

```bash
git add types/next-auth.d.ts lib/auth.ts
git commit -m "feat(sucursales): sesion lleva sucursalId (users.sucursal_id)"
```

---

### Task 2: `lib/sucursal.ts` — resolución pura (TDD)

**Files:**
- Create: `lib/sucursal.ts`
- Test: `lib/__tests__/sucursal.test.ts`

- [ ] **Step 1: Escribir los tests primero**

Crear `lib/__tests__/sucursal.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { resolveSucursalLectura, resolveSucursalEscritura } from "@/lib/sucursal"

describe("resolveSucursalLectura", () => {
  it("TECNICO se filtra por su sucursal fija", () => {
    const r = resolveSucursalLectura({ role: "TECNICO", userSucursalId: "suc-1", cookieSucursalId: null })
    expect(r).toEqual({ sucursalId: "suc-1", verTodas: false })
  })

  it("VENDEDOR se filtra por su sucursal fija (ignora cookie)", () => {
    const r = resolveSucursalLectura({ role: "VENDEDOR", userSucursalId: "suc-2", cookieSucursalId: "suc-9" })
    expect(r).toEqual({ sucursalId: "suc-2", verTodas: false })
  })

  it("ADMIN sin cookie => ve todas (sin filtro)", () => {
    const r = resolveSucursalLectura({ role: "ADMIN", userSucursalId: null, cookieSucursalId: null })
    expect(r).toEqual({ sucursalId: null, verTodas: true })
  })

  it("ADMIN con cookie de sucursal => filtra por esa", () => {
    const r = resolveSucursalLectura({ role: "ADMIN", userSucursalId: null, cookieSucursalId: "suc-3" })
    expect(r).toEqual({ sucursalId: "suc-3", verTodas: false })
  })

  it("ADMIN con cookie 'todas' => ve todas", () => {
    const r = resolveSucursalLectura({ role: "ADMIN", userSucursalId: null, cookieSucursalId: "todas" })
    expect(r).toEqual({ sucursalId: null, verTodas: true })
  })
})

describe("resolveSucursalEscritura", () => {
  it("TECNICO escribe en su sucursal fija", () => {
    const r = resolveSucursalEscritura({ role: "TECNICO", userSucursalId: "suc-1", cookieSucursalId: null, principalId: "suc-p" })
    expect(r).toBe("suc-1")
  })

  it("ADMIN sin cookie escribe en la principal (Casa Central)", () => {
    const r = resolveSucursalEscritura({ role: "ADMIN", userSucursalId: null, cookieSucursalId: null, principalId: "suc-p" })
    expect(r).toBe("suc-p")
  })

  it("ADMIN con cookie de sucursal escribe en esa", () => {
    const r = resolveSucursalEscritura({ role: "ADMIN", userSucursalId: null, cookieSucursalId: "suc-3", principalId: "suc-p" })
    expect(r).toBe("suc-3")
  })

  it("ADMIN con cookie 'todas' cae a la principal para escribir", () => {
    const r = resolveSucursalEscritura({ role: "ADMIN", userSucursalId: null, cookieSucursalId: "todas", principalId: "suc-p" })
    expect(r).toBe("suc-p")
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run lib/__tests__/sucursal.test.ts`
Expected: FAIL — `resolveSucursalLectura`/`resolveSucursalEscritura` no existen.

- [ ] **Step 3: Implementar las funciones puras**

Crear `lib/sucursal.ts`:

```typescript
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"

export const SUCURSAL_COOKIE = "stapp-sucursal-activa"
const TODAS = "todas"

export interface ResultadoLectura {
  sucursalId: string | null // null => sin filtro de sucursal (ver todas)
  verTodas: boolean
}

interface InputResolucion {
  role: string | null
  userSucursalId: string | null
  cookieSucursalId: string | null
}

/** Resuelve el filtro de sucursal para LECTURAS. */
export function resolveSucursalLectura(input: InputResolucion): ResultadoLectura {
  const esAdmin = input.role === "ADMIN"

  if (!esAdmin) {
    // TECNICO/VENDEDOR: su sucursal fija, ignora cookie.
    return { sucursalId: input.userSucursalId, verTodas: false }
  }

  // ADMIN: cookie manda. Sin cookie o 'todas' => ver todas.
  if (!input.cookieSucursalId || input.cookieSucursalId === TODAS) {
    return { sucursalId: null, verTodas: true }
  }
  return { sucursalId: input.cookieSucursalId, verTodas: false }
}

/** Resuelve la sucursal CONCRETA para ESCRITURAS (siempre devuelve un id). */
export function resolveSucursalEscritura(
  input: InputResolucion & { principalId: string }
): string {
  const esAdmin = input.role === "ADMIN"

  if (!esAdmin) {
    return input.userSucursalId ?? input.principalId
  }
  if (!input.cookieSucursalId || input.cookieSucursalId === TODAS) {
    return input.principalId
  }
  return input.cookieSucursalId
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/__tests__/sucursal.test.ts`
Expected: PASS — 9/9.

- [ ] **Step 5: Commit**

```bash
git add lib/sucursal.ts lib/__tests__/sucursal.test.ts
git commit -m "feat(sucursales): lib/sucursal.ts resolucion pura de sucursal (lectura/escritura)"
```

---

### Task 3: Wrapper server `getSucursalServer` + `assertSucursalEnOrg`

**Files:**
- Modify: `lib/sucursal.ts` (agregar wrappers que tocan cookie/DB)

- [ ] **Step 1: Agregar los wrappers server**

Agregar al final de `lib/sucursal.ts`:

```typescript
/** Lee el id de la sucursal principal (Casa Central) de una org. */
export async function getPrincipalId(organizationId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("sucursales")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("principal", true)
    .is("deleted_at", null)
    .single()
  return data?.id ?? null
}

/** Valida que una sucursal pertenezca a la org y esté activa. Previene cross-org. */
export async function assertSucursalEnOrg(
  sucursalId: string,
  organizationId: string
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("sucursales")
    .select("id")
    .eq("id", sucursalId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .single()
  return !!data
}

/** Lee la cookie de sucursal activa (server-side). */
export async function getCookieSucursalId(): Promise<string | null> {
  const store = await cookies()
  return store.get(SUCURSAL_COOKIE)?.value ?? null
}

/** Resuelve la sucursal concreta para una ESCRITURA en el request actual. */
export async function sucursalParaEscritura(params: {
  role: string | null
  organizationId: string
  userSucursalId: string | null
}): Promise<string | null> {
  const cookieSucursalId = await getCookieSucursalId()
  const principalId = await getPrincipalId(params.organizationId)
  if (!principalId) return null
  return resolveSucursalEscritura({
    role: params.role,
    userSucursalId: params.userSucursalId,
    cookieSucursalId,
    principalId,
  })
}

/** Resuelve el filtro de sucursal para una LECTURA en el request actual. */
export async function sucursalParaLectura(params: {
  role: string | null
  userSucursalId: string | null
}): Promise<ResultadoLectura> {
  const cookieSucursalId = await getCookieSucursalId()
  return resolveSucursalLectura({
    role: params.role,
    userSucursalId: params.userSucursalId,
    cookieSucursalId,
  })
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos. (Los wrappers no rompen los tests puros existentes.)

- [ ] **Step 3: Commit**

```bash
git add lib/sucursal.ts
git commit -m "feat(sucursales): wrappers server (cookie, principal, assertSucursalEnOrg)"
```

---

### Task 4: ESCRITURA + LECTURA de órdenes

**Files:**
- Modify: `app/api/ordenes/route.ts`
- Test: `__tests__/api/ordenes.test.ts` (existe)

- [ ] **Step 1: Escribir test de que la orden nace con `sucursal_id`**

Agregar a `__tests__/api/ordenes.test.ts` un caso: con `mockAuthSuccess({ role: "TECNICO", organizationId: "org-1", userId: "u-1" })` y la sesión exponiendo `sucursalId: "suc-1"`, al hacer POST de una orden válida, el objeto pasado a `.insert()` de `ordenes_servicio` incluye `sucursal_id`. Seguir el patrón de mocks del archivo (mockear `sucursales` → principal, y `ordenes_servicio` → capturar insert). Como el mock de `auth()` define la sesión, extender `mockAuthSuccess` o el mock local para incluir `sucursalId`.

```typescript
it("la orden nace con sucursal_id del contexto", async () => {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "u-1", organizationId: "org-1", role: "TECNICO", sucursalId: "suc-1", email: "t@t.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
  const insertSpy = vi.fn().mockReturnValue(createChainMock({ id: "ord-1" }, null))
  mockSupabaseFrom({
    sucursales: createChainMock({ id: "suc-p" }, null),
    ordenes_servicio: { ...createChainMock({ id: "ord-1" }, null), insert: insertSpy },
    // ...mocks adicionales que el handler requiera (clientes, counters, etc.)
  })
  // ...invocar POST con body válido...
  expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ sucursal_id: "suc-1" }))
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run __tests__/api/ordenes.test.ts -t "sucursal_id del contexto"`
Expected: FAIL — el insert no incluye `sucursal_id`.

- [ ] **Step 3: Wire la escritura en el POST**

En `app/api/ordenes/route.ts`, en el handler POST, tras `requireAuth()` (que da `organizationId`, `userId`, `role`, `session`), resolver la sucursal antes del insert:

```typescript
import { sucursalParaEscritura } from "@/lib/sucursal"
// ...
const sucursalId = await sucursalParaEscritura({
  role,
  organizationId: organizationId!,
  userSucursalId: session!.user.sucursalId ?? null,
})
```

Y en el objeto del `.insert()` a `ordenes_servicio` (línea ~306-342), agregar:

```typescript
    sucursal_id: sucursalId,
```

- [ ] **Step 4: Wire la lectura en el GET**

En el GET (query a `ordenes_servicio`, ~línea 98-114), tras `.eq("organization_id", organizationId!)` agregar el filtro condicional:

```typescript
import { sucursalParaLectura } from "@/lib/sucursal"
// ...
const filtro = await sucursalParaLectura({ role, userSucursalId: session!.user.sucursalId ?? null })
if (!filtro.verTodas && filtro.sucursalId) {
  query = query.eq("sucursal_id", filtro.sucursalId)
}
```

- [ ] **Step 5: Correr tests y verificar que pasan**

Run: `npx vitest run __tests__/api/ordenes.test.ts`
Expected: PASS — incluido el caso nuevo y los existentes (sin regresión).

- [ ] **Step 6: Commit**

```bash
git add app/api/ordenes/route.ts __tests__/api/ordenes.test.ts
git commit -m "feat(sucursales): ordenes escriben/filtran por sucursal_id"
```

---

### Task 5: RPC `crear_venta_atomica` con `p_sucursal_id` + route de ventas

**Files:**
- Read: `supabase/migrations/200_series_en_venta_e_idempotencia.sql` (definición vigente de la RPC)
- Create: `supabase/migrations/206_crear_venta_atomica_sucursal.sql`
- Modify: `app/api/ventas/route.ts`
- Test: `__tests__/api/ventas.test.ts` (existe)

- [ ] **Step 1: Obtener la definición vigente y su firma exacta**

Leer la ÚLTIMA `CREATE OR REPLACE FUNCTION crear_venta_atomica(...)` (está en `200_series_en_venta_e_idempotencia.sql`; si una migración posterior la redefine, usar esa). Anotar la lista EXACTA de parámetros con sus tipos — se necesita para el `DROP FUNCTION` (Postgres identifica la función por nombre + tipos de args).

- [ ] **Step 2: Escribir la migración 206**

Crear `supabase/migrations/206_crear_venta_atomica_sucursal.sql`. Estructura (rellenar con el cuerpo vigente copiado del Step 1):

```sql
-- ========================================
-- 206: crear_venta_atomica + p_sucursal_id
-- ========================================
-- Agrega sucursal_id al INSERT de ventas dentro de la RPC atómica.
-- DROP del signature viejo ANTES de recrear: agregar un parámetro cambia la
-- firma y, con DEFAULT, generaría overload ambiguo (ver fix mig 055).
-- Copiar el CUERPO COMPLETO de la última definición (mig 200) y aplicar 2 cambios:
--   1) agregar  p_sucursal_id TEXT DEFAULT NULL  al final de la lista de params
--   2) agregar  sucursal_id  a la columna+valor del INSERT INTO ventas (...)

-- Reemplazar la firma de abajo por la EXACTA del Step 1:
DROP FUNCTION IF EXISTS crear_venta_atomica(
  TEXT, TEXT, TEXT, TEXT, /* ...resto de tipos EXACTOS de la def vigente... */
);

CREATE OR REPLACE FUNCTION crear_venta_atomica(
  /* ...todos los params vigentes, sin cambios... */
  p_sucursal_id TEXT DEFAULT NULL   -- NUEVO, al final
) RETURNS JSONB AS $$
-- ...CUERPO COMPLETO vigente, con el único cambio en el INSERT INTO ventas:
--   INSERT INTO ventas (..., organization_id, sucursal_id)
--   VALUES            (..., p_org_id,         p_sucursal_id)
$$ LANGUAGE plpgsql;
```

> El INSERT a `ventas` en la def vigente lista columnas explícitas terminando en `organization_id`. Agregar `, sucursal_id` a la lista de columnas y `, p_sucursal_id` a la lista de `VALUES`. No tocar el resto del cuerpo.

- [ ] **Step 3: Aplicar 206 en el SQL Editor de Supabase (staging)**

Pegar y ejecutar. Esperado: sin errores. Verificar firma:

```sql
SELECT pg_get_function_identity_arguments(oid)
FROM pg_proc WHERE proname = 'crear_venta_atomica';
```
Esperado: una sola fila, con `p_sucursal_id text` al final (no debe haber 2 overloads).

- [ ] **Step 4: Escribir test de que la venta pasa `p_sucursal_id`**

En `__tests__/api/ventas.test.ts`, agregar caso: con sesión `role: "VENDEDOR", sucursalId: "suc-1"`, el POST llama `supabaseAdmin.rpc("crear_venta_atomica", ...)` con `p_sucursal_id` resuelto. Mockear `rpc` y capturar el segundo argumento.

```typescript
it("la venta pasa p_sucursal_id a la RPC", async () => {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "v-1", organizationId: "org-1", role: "VENDEDOR", sucursalId: "suc-1", email: "v@v.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
  const rpcSpy = vi.spyOn(supabaseAdmin, "rpc").mockResolvedValue({ data: { ventaId: "vt-1" }, error: null } as any)
  mockSupabaseFrom({ sucursales: createChainMock({ id: "suc-p" }, null) })
  // ...invocar POST con body de venta válido...
  expect(rpcSpy).toHaveBeenCalledWith("crear_venta_atomica", expect.objectContaining({ p_sucursal_id: "suc-1" }))
})
```

- [ ] **Step 5: Correr el test y verificar que falla**

Run: `npx vitest run __tests__/api/ventas.test.ts -t "p_sucursal_id a la RPC"`
Expected: FAIL — `rpcParams` no tiene `p_sucursal_id`.

- [ ] **Step 6: Wire la route de ventas**

En `app/api/ventas/route.ts`, tras `requireAuth()`/resolución de sesión, resolver la sucursal y agregarla a `rpcParams` (objeto pasado a `.rpc("crear_venta_atomica", rpcParams)`, ~línea 201-231):

```typescript
import { sucursalParaEscritura } from "@/lib/sucursal"
// ...
const sucursalId = await sucursalParaEscritura({
  role,
  organizationId: organizationId!,
  userSucursalId: session!.user.sucursalId ?? null,
})
const rpcParams = {
  // ...params existentes...
  p_sucursal_id: sucursalId,
}
```

Y en el GET de ventas (~línea 77-100), tras `.eq("organization_id", organizationId!)`:

```typescript
import { sucursalParaLectura } from "@/lib/sucursal"
// ...
const filtro = await sucursalParaLectura({ role, userSucursalId: session!.user.sucursalId ?? null })
if (!filtro.verTodas && filtro.sucursalId) {
  query = query.eq("sucursal_id", filtro.sucursalId)
}
```

- [ ] **Step 7: Correr tests y verificar que pasan**

Run: `npx vitest run __tests__/api/ventas.test.ts`
Expected: PASS — caso nuevo + existentes.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/206_crear_venta_atomica_sucursal.sql app/api/ventas/route.ts __tests__/api/ventas.test.ts
git commit -m "feat(sucursales): ventas escriben/filtran por sucursal (RPC p_sucursal_id)"
```

---

### Task 6: ESCRITURA + LECTURA de caja (sesiones + movimientos)

**Files:**
- Modify: `app/api/caja/sesiones/route.ts`
- Modify: `app/api/caja/movimientos/route.ts`
- Test: `__tests__/api/movimientos.test.ts` (existe)

- [ ] **Step 1: Escribir test de que el movimiento de caja nace con `sucursal_id`**

En `__tests__/api/movimientos.test.ts`, agregar caso análogo al de órdenes (Task 4 Step 1): sesión con `sucursalId`, POST de movimiento, el `.insert()` a `movimientos_caja` incluye `sucursal_id`.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run __tests__/api/movimientos.test.ts -t "sucursal_id"`
Expected: FAIL.

- [ ] **Step 3: Wire `caja/sesiones`**

En `app/api/caja/sesiones/route.ts`, en el POST (insert a `sesiones_caja`, ~línea 117-127), resolver y agregar `sucursal_id: sucursalId` (igual patrón que Task 4 Step 3). En el GET (~línea 22-27), agregar el filtro condicional (Task 4 Step 4).

- [ ] **Step 4: Wire `caja/movimientos`**

En `app/api/caja/movimientos/route.ts`, en el insert a `movimientos_caja` (~línea 96-112), agregar `sucursal_id: sucursalId`. En el GET, filtro condicional.

- [ ] **Step 5: Correr tests y verificar que pasan**

Run: `npx vitest run __tests__/api/movimientos.test.ts`
Expected: PASS — caso nuevo + existentes.

- [ ] **Step 6: Commit**

```bash
git add app/api/caja/sesiones/route.ts app/api/caja/movimientos/route.ts __tests__/api/movimientos.test.ts
git commit -m "feat(sucursales): caja (sesiones+movimientos) escribe/filtra por sucursal"
```

---

### Task 7: Asignación de sucursal al crear técnicos/vendedores

**Files:**
- Modify: `app/api/tecnicos/route.ts`
- Modify: `app/api/vendedores/route.ts`

- [ ] **Step 1: Wire el insert de técnicos**

En `app/api/tecnicos/route.ts` (insert a `users`, ~línea 130-146), el creador es ADMIN. Asignar el nuevo técnico a la sucursal activa del admin (o la principal si no hay cookie):

```typescript
import { sucursalParaEscritura } from "@/lib/sucursal"
// ...
const sucursalId = await sucursalParaEscritura({
  role,
  organizationId: organizationId!,
  userSucursalId: null, // el admin asigna; default principal/cookie
})
```

Y en el `.insert({ ... })` agregar `sucursal_id: sucursalId,`.

- [ ] **Step 2: Wire el insert de vendedores**

Igual en `app/api/vendedores/route.ts` (insert a `users`, ~línea 138-150): resolver `sucursalId` y agregar `sucursal_id: sucursalId,` al insert.

> Nota: el selector de sucursal en el form de alta de usuario llega en Fase 3. En Fase 2 el nuevo técnico/vendedor queda en la sucursal activa del admin (principal por defecto), lo cual es correcto para orgs de una sola sucursal.

- [ ] **Step 3: Verificar typecheck/build**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 4: Commit**

```bash
git add app/api/tecnicos/route.ts app/api/vendedores/route.ts
git commit -m "feat(sucursales): nuevos tecnicos/vendedores se asignan a sucursal"
```

---

### Task 8: Migración `SET NOT NULL` (aplicar SOLO tras deploy del código)

**Files:**
- Create: `supabase/migrations/207_sucursales_set_not_null.sql`

> **CRÍTICO — ORDEN DE DEPLOY:** Esta migración NO debe aplicarse hasta que el código de Tasks 1-7 esté **desplegado en producción** y escribiendo `sucursal_id` en cada INSERT. Aplicarla antes rompería los INSERT que aún no setean la columna. Secuencia: (1) merge + deploy del código de Fase 2 → (2) recién entonces aplicar 207 en prod.

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/207_sucursales_set_not_null.sql`:

```sql
-- ========================================
-- 207: SUCURSALES — SET NOT NULL (diferido de Fase 1)
-- ========================================
-- Aplicar SOLO después de desplegar el código de Fase 2 (app-layer), que ya
-- escribe sucursal_id en órdenes/ventas/caja. users.sucursal_id queda nullable
-- (ADMIN = NULL = ve todas).
-- Pre-chequeo defensivo: abortar si quedó alguna fila con sucursal_id NULL.

DO $$
DECLARE
  v_nulos INTEGER;
BEGIN
  SELECT
    (SELECT COUNT(*) FROM ordenes_servicio WHERE sucursal_id IS NULL)
    + (SELECT COUNT(*) FROM ventas WHERE sucursal_id IS NULL)
    + (SELECT COUNT(*) FROM sesiones_caja WHERE sucursal_id IS NULL)
    + (SELECT COUNT(*) FROM movimientos_caja WHERE sucursal_id IS NULL)
    + (SELECT COUNT(*) FROM depositos WHERE sucursal_id IS NULL)
  INTO v_nulos;
  IF v_nulos > 0 THEN
    RAISE EXCEPTION 'Abort: % fila(s) con sucursal_id NULL. Backfillear antes de SET NOT NULL.', v_nulos;
  END IF;
END $$;

ALTER TABLE ordenes_servicio ALTER COLUMN sucursal_id SET NOT NULL;
ALTER TABLE ventas           ALTER COLUMN sucursal_id SET NOT NULL;
ALTER TABLE sesiones_caja    ALTER COLUMN sucursal_id SET NOT NULL;
ALTER TABLE movimientos_caja ALTER COLUMN sucursal_id SET NOT NULL;
ALTER TABLE depositos        ALTER COLUMN sucursal_id SET NOT NULL;
```

- [ ] **Step 2: Commit (sin aplicar todavía)**

```bash
git add supabase/migrations/207_sucursales_set_not_null.sql
git commit -m "feat(sucursales): migracion SET NOT NULL diferida (aplicar post-deploy)"
```

- [ ] **Step 3: (Post-deploy) Aplicar en prod y verificar**

Tras desplegar el código de Fase 2: pegar 207 en el SQL Editor de prod. Si aborta con el RAISE, hay filas viejas sin sucursal — re-correr el backfill de `202` (el bloque de UPDATEs) y reintentar.

---

## Self-Review

**Cobertura del spec (Sección 3 app-layer):**
- Sesión con `sucursalId` → Task 1. ✓
- Cookie `stapp-sucursal-activa` → Task 3 (`getCookieSucursalId`, `SUCURSAL_COOKIE`). ✓
- Helper central (`getSucursalContext`/`resolveSucursalFiltro`/`assertSucursalEnOrg`) → Tasks 2-3 (`resolveSucursalLectura`/`Escritura`, `sucursalPara*`, `assertSucursalEnOrg`). ✓
- Escritura toma sucursal del contexto server-side, no del cliente → Tasks 4-7. ✓
- Lectura filtra por sucursal (admin "todas" = sin filtro) → Tasks 4-6. ✓
- Validación cross-org → `assertSucursalEnOrg` (Task 3); disponible para usar cuando el cliente mande sucursal explícita (Fase 3).
- NOT NULL diferido → Task 8. ✓

**Fuera de esta fase (Fase 3-4):** switcher UI, ABM de sucursales, selector de sucursal en alta de usuario, columna/badge de sucursal en listados, plan PRO billing/pricing. Correcto.

**Placeholders:** Task 5 referencia el cuerpo de la RPC vigente en vez de reproducir ~200 líneas — es instrucción completa (2 cambios puntuales + DROP del signature exacto leído en Step 1), no un TBD. Resto sin placeholders.

**Consistencia de nombres:** `sucursalParaEscritura`/`sucursalParaLectura` (wrappers async) y `resolveSucursalEscritura`/`resolveSucursalLectura` (puras) usados consistentes entre Tasks 2-7. `session.user.sucursalId` coincide con el tipo de Task 1. `SUCURSAL_COOKIE = "stapp-sucursal-activa"` coincide con el spec.

**Riesgo principal:** olvidar un INSERT/SELECT que deba scopearse. Mitigación: el scope de Fase 2 se limita a las entidades del spec (órdenes/ventas/caja/users/depósitos); `clientes`, `proveedores`, `inventario` NO recibieron `sucursal_id` (compartidos por org) y quedan fuera a propósito.

## Notas para Fase 3 (no ejecutar ahora)

Fase 3 (UI): switcher de sucursal en `components/layout/navbar.tsx` (client, `useSession()`) que setea la cookie `stapp-sucursal-activa`; ABM en `app/(dashboard)/configuracion/sucursales/` con gate por `check_plan_limit(org,'sucursales')`; selector de sucursal en alta de técnico/vendedor; badge de sucursal en listados cuando el admin ve "todas".
