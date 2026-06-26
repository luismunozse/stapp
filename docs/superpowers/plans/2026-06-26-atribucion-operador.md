# Atribución de operador (recibido por + vendedor en POS) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poder elegir el operador real de cada acción en una PC compartida: quién recibió el equipo (órdenes) y quién vendió (POS), con selección libre sin PIN.

**Architecture:** Un helper server-side `resolveOperador` valida que el actor elegido pertenezca a la org (y rol válido) o cae al usuario de la sesión. Un endpoint `GET /api/operadores` lista los operadores disponibles de la sucursal. Las dos rutas (`/api/ordenes`, `/api/ventas`) reciben el actor elegido, lo validan y lo persisten (`ordenes_servicio.recibido_por` nuevo; `ventas.vendedor_id` ya existe). Los selectores en el form de orden y en el checkout del POS lo eligen, default = usuario logueado.

**Tech Stack:** Next.js (App Router) + TypeScript, Supabase (Postgres), Zod, Vitest (entorno node para lógica/API), shadcn `Select`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-26-atribucion-operador-design.md`.
- **Selección libre, sin PIN.** No se toca `users` (salvo lectura) ni el login.
- **Server-authoritative:** un actor inválido/ajeno NUNCA se persiste → fallback al `userId` de la sesión.
- **Trazabilidad doble:** actor atribuido en el registro + operador en el audit log existente (NO se toca `lib/audit.ts`).
- Commits convencionales, SIN atribución AI.
- Artefactos/UI en español neutro (matchear el código vecino).
- Vitest en Windows: `node node_modules/vitest/vitest.mjs run <archivo>`. Tests de lógica/API: `// @vitest-environment node`.
- Migración: próximo número libre (al escribir: `260`; verificar con `ls supabase/migrations | grep -oE '^[0-9]+' | sort -n | tail -1`).
- Helpers de test API: `__tests__/api/helpers.ts` (`mockAuthSuccess`, `mockSupabaseFrom`, `createChainMock`, `createPostRequest`, `parseResponse`).
- Patrón de listado de usuarios: `app/api/tecnicos/route.ts` (GET), `app/api/vendedores/route.ts` (GET).

---

### Task 1: Migración — `ordenes_servicio.recibido_por`

**Files:**
- Create: `supabase/migrations/260_ordenes_recibido_por.sql` (verificar número libre antes)

**Interfaces:**
- Produces: columna `ordenes_servicio.recibido_por TEXT REFERENCES users(id)` (nullable). La usan Tasks 6-7.

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/260_ordenes_recibido_por.sql`:

```sql
-- ========================================
-- Migration 260: ordenes_servicio.recibido_por
-- ========================================
-- Quién RECIBIÓ el equipo en la recepción (operador del mostrador), distinto de
-- tecnico_id (quién repara). Selección libre, nullable. Sin backfill.

ALTER TABLE ordenes_servicio
  ADD COLUMN IF NOT EXISTS recibido_por TEXT REFERENCES users(id);

CREATE INDEX IF NOT EXISTS ordenes_recibido_por_idx
  ON ordenes_servicio(organization_id, recibido_por);
```

- [ ] **Step 2: Verificar número libre**

Run: `ls supabase/migrations | grep -oE '^[0-9]+' | sort -n | tail -1`
Expected: el mayor < 260 (si es ≥ 260, renombrar a mayor+1).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/260_ordenes_recibido_por.sql
git commit -m "feat(db): ordenes_servicio.recibido_por (operador de recepción)"
```

Nota: se aplica a Supabase manualmente post-merge (como 230/238/259).

---

### Task 2: Helper `resolveOperador`

**Files:**
- Create: `lib/operadores.ts`
- Test: `__tests__/lib/operadores.test.ts`

**Interfaces:**
- Consumes: `supabaseAdmin` de `@/lib/supabase`.
- Produces: `resolveOperador(organizationId: string, actorId: string | null | undefined, fallbackUserId: string, opts?: { roles?: string[] }): Promise<string>` — devuelve `actorId` si es un usuario activo de la org (y, si se pasa `roles`, con rol incluido); si no, `fallbackUserId`.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/lib/operadores.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { resolveOperador } from "@/lib/operadores"

function mockUser(row: any) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  }
  vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)
}

describe("resolveOperador", () => {
  beforeEach(() => vi.clearAllMocks())

  it("sin actorId => fallback", async () => {
    expect(await resolveOperador("org-1", null, "sess-1")).toBe("sess-1")
    expect(await resolveOperador("org-1", undefined, "sess-1")).toBe("sess-1")
  })

  it("actor válido y activo => actorId", async () => {
    mockUser({ id: "u2", rol: "VENDEDOR", activo: true })
    expect(await resolveOperador("org-1", "u2", "sess-1")).toBe("u2")
  })

  it("actor inactivo => fallback", async () => {
    mockUser({ id: "u2", rol: "VENDEDOR", activo: false })
    expect(await resolveOperador("org-1", "u2", "sess-1")).toBe("sess-1")
  })

  it("actor inexistente / otra org => fallback", async () => {
    mockUser(null)
    expect(await resolveOperador("org-1", "u9", "sess-1")).toBe("sess-1")
  })

  it("rol no permitido => fallback", async () => {
    mockUser({ id: "u2", rol: "TECNICO", activo: true })
    expect(await resolveOperador("org-1", "u2", "sess-1", { roles: ["VENDEDOR", "ADMIN"] })).toBe("sess-1")
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node node_modules/vitest/vitest.mjs run __tests__/lib/operadores.test.ts`
Expected: FAIL — `lib/operadores` no existe.

- [ ] **Step 3: Implementar**

Crear `lib/operadores.ts`:

```ts
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Valida que `actorId` sea un usuario activo de la org (y, si se pasa `roles`,
 * con rol permitido). Devuelve el actor válido o `fallbackUserId`.
 * Server-authoritative: nunca persiste un id ajeno o inválido.
 */
export async function resolveOperador(
  organizationId: string,
  actorId: string | null | undefined,
  fallbackUserId: string,
  opts?: { roles?: string[] }
): Promise<string> {
  if (!actorId) return fallbackUserId
  const { data } = await supabaseAdmin
    .from("users")
    .select("id, rol, activo")
    .eq("id", actorId)
    .eq("organization_id", organizationId)
    .maybeSingle()
  if (!data) return fallbackUserId
  if (data.activo === false) return fallbackUserId
  if (opts?.roles && !opts.roles.includes(data.rol)) return fallbackUserId
  return data.id
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node node_modules/vitest/vitest.mjs run __tests__/lib/operadores.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/operadores.ts __tests__/lib/operadores.test.ts
git commit -m "feat(operadores): helper resolveOperador (validación server-side del actor)"
```

---

### Task 3: Endpoint `GET /api/operadores`

Lista operadores disponibles de la sucursal activa para los selectores. Incluye ADMINs (cross-sucursal). Filtro opcional `?rol=`.

**Files:**
- Create: `app/api/operadores/route.ts`
- Test: `__tests__/api/operadores.test.ts`

**Interfaces:**
- Produces: `GET /api/operadores[?rol=VENDEDOR]` → `[{ id: string, nombre: string, rol: string }]` (usuarios activos). Lo consumen Tasks 5 y 7.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/api/operadores.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"
import { GET } from "@/app/api/operadores/route"

describe("GET /api/operadores", () => {
  beforeEach(() => vi.clearAllMocks())

  it("devuelve usuarios activos de la org", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      users: createChainMock([
        { id: "u1", nombre: "Ana", rol: "VENDEDOR" },
        { id: "u2", nombre: "Beto", rol: "ADMIN" },
      ]),
    })
    const res = await GET(new Request("http://localhost/api/operadores"))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.map((o: any) => o.id)).toEqual(["u1", "u2"])
  })

  it("401 sin auth", async () => {
    mockAuthSuccess({ role: "ADMIN", fail: true } as any)
    // Si el helper no soporta `fail`, simular requireAuth devolviendo error:
    // alternativamente, omitir este test si no es trivial con los helpers.
  })
})
```

Nota: leer `__tests__/api/helpers.ts` para la firma real de `mockAuthSuccess`/`parseResponse`; si no hay forma trivial de simular el 401, dejar solo el test del happy path (es suficiente para el gate). Ajustar `parseResponse` al shape real (`{status, body}`).

- [ ] **Step 2: Correr y verificar que falla**

Run: `node node_modules/vitest/vitest.mjs run __tests__/api/operadores.test.ts`
Expected: FAIL — la ruta no existe.

- [ ] **Step 3: Implementar el endpoint**

Crear `app/api/operadores/route.ts` (patrón de auth/sucursal de `app/api/tecnicos/route.ts` + `lib/sucursal`):

```ts
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"

export async function GET(request: Request) {
  try {
    const { error, organizationId, role, session } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const rol = searchParams.get("rol")

    const filtro = await sucursalParaLectura({
      role,
      userSucursalId: session!.user.sucursalId ?? null,
    })

    let query = supabaseAdmin
      .from("users")
      .select("id, nombre, rol")
      .eq("organization_id", organizationId!)
      .eq("activo", true)
      .order("nombre", { ascending: true })

    if (rol) query = query.eq("rol", rol)

    // Operadores de la sucursal activa + ADMINs (cross-sucursal). ADMIN sin
    // cookie ('todas') => todos los de la org.
    if (!filtro.verTodas && filtro.sucursalId) {
      query = query.or(`sucursal_id.eq.${filtro.sucursalId},rol.eq.ADMIN`)
    }

    const { data, error: dbError } = await query
    if (dbError) throw dbError

    return NextResponse.json(data ?? [], {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (e) {
    console.error("Error fetching operadores:", e)
    return NextResponse.json({ error: "Error al obtener operadores" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node node_modules/vitest/vitest.mjs run __tests__/api/operadores.test.ts`
Expected: PASS (happy path). `npx tsc --noEmit` exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/api/operadores/route.ts __tests__/api/operadores.test.ts
git commit -m "feat(operadores): GET /api/operadores (lista por sucursal, filtro por rol)"
```

---

### Task 4: Ventas — aceptar y validar `vendedorId` (server)

**Files:**
- Modify: `app/api/ventas/route.ts` (schema `:23-50`; uso de `p_vendedor_id` `:302`; imports `:1-8`)
- Test: `__tests__/api/ventas-vendedor-operador.test.ts` (nuevo)

**Interfaces:**
- Consumes: `resolveOperador` de `@/lib/operadores`.
- Produces: la venta se crea con `vendedor_id` = el actor validado (o el usuario de sesión).

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/api/ventas-vendedor-operador.test.ts`. Mockear `@/lib/operadores.resolveOperador` y verificar que `p_vendedor_id` enviado a la RPC = el resultado de `resolveOperador` (no siempre `userId`). Patrón: `__tests__/api/ventas-recargo-metodo.test.ts`.

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, createPostRequest, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/operadores", () => ({ resolveOperador: vi.fn().mockResolvedValue("vend-elegido") }))
vi.mock("@/lib/audit", () => ({ createAuditLogger: () => ({ create: vi.fn() }) }))
vi.mock("@/lib/webhooks/dispatcher", () => ({ emitWebhookEvent: vi.fn() }))

import { POST } from "@/app/api/ventas/route"

describe("POST /api/ventas — vendedor seleccionable", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ organizations: createChainMock({ iva_regimen: "EXENTO" }) })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { ventaId: "v1", numeroVenta: 1, garantias: [], items: ["i1"] }, error: null,
    } as any)
  })

  it("usa el vendedor resuelto por resolveOperador en p_vendedor_id", async () => {
    const body = {
      clienteNombre: "Consumidor Final",
      items: [{ inventarioId: "inv1", descripcion: "X", cantidad: 1, precioUnitario: 1000, diasGarantia: 0, descuento: 0, tipoDescuento: "MONTO", porcentajeDescuento: 0 }],
      descuento: 0, tipoDescuento: "MONTO", porcentajeDescuento: 0,
      metodoPago: "EFECTIVO",
      pagos: [{ metodo: "EFECTIVO", monto: 1000 }],
      vendedorId: "vend-elegido",
    }
    const res = await POST(createPostRequest(body, "http://localhost/api/ventas"), {} as any)
    await parseResponse(res)
    const [, params] = vi.mocked(supabaseAdmin.rpc).mock.calls[0]
    expect(params.p_vendedor_id).toBe("vend-elegido")
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node node_modules/vitest/vitest.mjs run __tests__/api/ventas-vendedor-operador.test.ts`
Expected: FAIL — `p_vendedor_id` = `userId` (sesión), no `"vend-elegido"`.

- [ ] **Step 3: Implementar**

En `app/api/ventas/route.ts`:
1. Import (`:7-8`): `import { resolveOperador } from "@/lib/operadores"`
2. En `ventaSchema` (`:23-50`), agregar: `vendedorId: z.string().nullable().optional(),`
3. Antes de armar `rpcParams` (~`:290`), resolver el vendedor:
```ts
const vendedorId = await resolveOperador(
  organizationId!, data.vendedorId, userId!, { roles: ["VENDEDOR", "ADMIN"] }
)
```
4. En `rpcParams` (`:302`), cambiar `p_vendedor_id: userId!` por `p_vendedor_id: vendedorId`.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node node_modules/vitest/vitest.mjs run __tests__/api/ventas-vendedor-operador.test.ts`
Expected: PASS
Run (regresión): `node node_modules/vitest/vitest.mjs run __tests__/api/ventas-recargo-metodo.test.ts __tests__/api/ventas-pr2.test.ts` → PASS
Run: `npx tsc --noEmit` → exit 0

- [ ] **Step 5: Commit**

```bash
git add app/api/ventas/route.ts __tests__/api/ventas-vendedor-operador.test.ts
git commit -m "feat(ventas): vendedor seleccionable validado server-side (p_vendedor_id)"
```

---

### Task 5: POS — selector de vendedor en el checkout

**Files:**
- Modify: `components/pos/pos-payload.ts` (interfaces `VentaPayload` + `BuildVentaPayloadInput`, función `buildVentaPayload`)
- Modify: `components/pos/pos-checkout-dialog.tsx` (selector + pasar vendedorId)

**Interfaces:**
- Consumes: `GET /api/operadores?rol=VENDEDOR` (Task 3); el campo `vendedorId` de `/api/ventas` (Task 4).

- [ ] **Step 1: Agregar `vendedorId` al payload**

En `components/pos/pos-payload.ts`:
1. En `BuildVentaPayloadInput` (interface), agregar: `vendedorId?: string | null`.
2. En `VentaPayload` (interface), agregar: `vendedorId?: string`.
3. En `buildVentaPayload`, leer `vendedorId` del input y emitirlo: `...(input.vendedorId ? { vendedorId: input.vendedorId } : {})` dentro del objeto retornado.

- [ ] **Step 2: Selector en el checkout**

En `components/pos/pos-checkout-dialog.tsx`:
1. Estado: `const [vendedores, setVendedores] = useState<Array<{id:string;nombre:string}>>([])` y `const [vendedorId, setVendedorId] = useState<string>(session?.user?.id ?? "")` (obtener el id de sesión como ya lo haga el componente; si no tiene la sesión a mano, recibirlo por props o vía `useSession`).
2. `useEffect` al abrir: `fetch("/api/operadores?rol=VENDEDOR").then(r=>r.json()).then(setVendedores)`.
3. Render un `<Select>` "Vendedor" (usar el componente `Select` de shadcn que ya usa el repo; mirar el selector de técnico en `components/ordenes/orden-form.tsx:1128-1146` para el patrón exacto de `Select`/`SelectItem`), value `vendedorId`, onChange `setVendedorId`.
4. Pasar `vendedorId` a `buildVentaPayload({ ..., vendedorId })`.
5. Default: el usuario de sesión preseleccionado.

- [ ] **Step 3: Verificación**

Run: `npx tsc --noEmit` → exit 0
Verificación manual: en el POS, el selector lista vendedores; al cobrar atribuye la venta al elegido (y la comisión lo sigue).

- [ ] **Step 4: Commit**

```bash
git add components/pos/pos-payload.ts components/pos/pos-checkout-dialog.tsx
git commit -m "feat(pos): selector de vendedor en el checkout (default usuario de sesión)"
```

---

### Task 6: Órdenes — aceptar y validar `recibidoPorId` (server)

**Files:**
- Modify: `app/api/ordenes/route.ts` (schema de validación del POST; INSERT `:378-403`; imports)
- Test: `__tests__/api/ordenes-recibido-por.test.ts` (nuevo)

**Interfaces:**
- Consumes: `resolveOperador` de `@/lib/operadores`; columna `recibido_por` (Task 1).
- Produces: la orden se crea con `recibido_por` = actor validado (o usuario de sesión).

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/api/ordenes-recibido-por.test.ts`. Mockear `@/lib/operadores.resolveOperador` y verificar que el INSERT a `ordenes_servicio` incluye `recibido_por` = el resultado de `resolveOperador`. Leer primero `app/api/ordenes/route.ts` y `__tests__/api/entregar.test.ts`/`devolucion-atomica.test.ts` para el patrón de mock del POST de órdenes (auth, mocks de tablas, cómo se captura el `.insert`).

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/operadores", () => ({ resolveOperador: vi.fn().mockResolvedValue("recep-elegido") }))
// Mockear otros módulos que el POST importe (audit, counters, etc.) según necesite el route.

import { POST } from "@/app/api/ordenes/route"

describe("POST /api/ordenes — recibido_por", () => {
  beforeEach(() => vi.clearAllMocks())

  it("persiste recibido_por con el actor resuelto", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    // Capturar el .insert() a ordenes_servicio:
    const insertSpy = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "o1", clientes: {} }, error: null }) }),
    })
    mockSupabaseFrom({
      ordenes_servicio: { insert: insertSpy } as any,
      // agregar mocks de las tablas que el POST consulte antes del insert (clientes, users, etc.)
    })

    const body = { /* payload mínimo válido de orden + */ recibidoPorId: "recep-elegido" }
    const res = await POST(createPostRequest(body, "http://localhost/api/ordenes"), {} as any)
    await parseResponse(res)
    const insertArg = insertSpy.mock.calls[0][0]
    expect(insertArg.recibido_por).toBe("recep-elegido")
  })
})
```

Nota: el POST de órdenes es complejo (valida cliente, plan limit, turno, etc.). El implementer DEBE leer la ruta y construir un `body` mínimo válido y los mocks de tablas necesarios para llegar al `.insert`. Si armar el happy-path completo es desproporcionado, validar en su lugar mediante un test más acotado del fragmento de resolución (extraer la resolución a una línea testeable) — pero preferir el test de integración del INSERT. Documentar en el reporte qué enfoque se usó.

- [ ] **Step 2: Correr y verificar que falla**

Run: `node node_modules/vitest/vitest.mjs run __tests__/api/ordenes-recibido-por.test.ts`
Expected: FAIL — `recibido_por` ausente en el insert.

- [ ] **Step 3: Implementar**

En `app/api/ordenes/route.ts`:
1. Import: `import { resolveOperador } from "@/lib/operadores"`.
2. En el schema de validación del POST, agregar `recibidoPorId` opcional (string nullable). (Ubicar el `z.object` del body de creación.)
3. Antes del INSERT (~`:378`), resolver: `const recibidoPor = await resolveOperador(organizationId!, data.recibidoPorId, userId!)`.
4. En el objeto del `.insert` a `ordenes_servicio` (`:378-403`), agregar: `recibido_por: recibidoPor,`.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node node_modules/vitest/vitest.mjs run __tests__/api/ordenes-recibido-por.test.ts`
Expected: PASS
Run (regresión): `node node_modules/vitest/vitest.mjs run __tests__/api/entregar.test.ts` → PASS
Run: `npx tsc --noEmit` → exit 0

- [ ] **Step 5: Commit**

```bash
git add app/api/ordenes/route.ts __tests__/api/ordenes-recibido-por.test.ts
git commit -m "feat(ordenes): recibido_por validado server-side en la creación"
```

---

### Task 7: Órdenes — selector "Recibido por" en el form

**Files:**
- Modify: `components/ordenes/orden-form.tsx` (estado + fetch + selector, espejo del selector de técnico `:1128-1146`; payload `:627`)

**Interfaces:**
- Consumes: `GET /api/operadores` (Task 3); el campo `recibidoPorId` de `/api/ordenes` (Task 6).

- [ ] **Step 1: Agregar estado + fetch + selector**

En `components/ordenes/orden-form.tsx`:
1. Estado: `const [operadores, setOperadores] = useState<Array<{id:string;nombre:string;rol:string}>>([])` y `const [selectedRecibidoPorId, setSelectedRecibidoPorId] = useState<string>("")`. Inicializar el default al id del usuario de sesión (el componente ya conoce el rol/usuario; usar la misma fuente). 
2. `useEffect`: `fetch("/api/operadores").then(r=>r.json()).then(setOperadores)`.
3. Render un `<Select>` "Recibido por" calcado del bloque de técnico (`:1128-1146`) — mismas clases/estructura `Select`/`SelectTrigger`/`SelectItem`, listando `operadores` (mostrar `nombre`). Ubicarlo cerca del selector de técnico.
4. En el payload de creación (donde se arma el body, ~`:627`), agregar `recibidoPorId: selectedRecibidoPorId || undefined`.

- [ ] **Step 2: Verificación**

Run: `npx tsc --noEmit` → exit 0
Verificación manual: al crear una orden, el selector "Recibido por" lista operadores, default = usuario logueado; la orden guarda el elegido.

- [ ] **Step 3: Commit**

```bash
git add components/ordenes/orden-form.tsx
git commit -m "feat(ordenes): selector Recibido por en el form (default usuario de sesión)"
```

---

### Task 8: Órdenes — mostrar "Recibido por" en el detalle

**Files:**
- Modify: la vista de detalle de la orden (localizar: `rg -l "tecnico" components/ordenes` y el componente que muestra el técnico asignado en el detalle / ticket de ingreso)
- Modify: `app/api/ordenes/[id]/route.ts` GET si el detalle necesita el join a `users:recibido_por`

**Interfaces:**
- Consumes: `ordenes_servicio.recibido_por` (Task 1).

- [ ] **Step 1: Exponer `recibido_por` en el GET del detalle**

En el GET que alimenta el detalle de la orden (`app/api/ordenes/[id]/route.ts` o el listado), agregar al `select` el join: `recibido:recibido_por (id, nombre)` (mismo patrón que `users:tecnico_id`). Mapear a `recibidoPor: { id, nombre }` en la respuesta.

- [ ] **Step 2: Mostrar en el detalle**

En el componente de detalle de orden (donde se muestra "Técnico asignado"), agregar una fila "Recibido por: {nombre}" cuando exista. Si hay ticket/comprobante de ingreso, incluirlo ahí también.

- [ ] **Step 3: Verificación**

Run: `npx tsc --noEmit` → exit 0
Verificación manual: el detalle de una orden con `recibido_por` muestra el nombre del operador.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ordenes): mostrar Recibido por en el detalle de la orden"
```

---

## Self-Review (cobertura del spec)

- **Migración `recibido_por`** → Task 1. ✅
- **Server-authoritative (fallback a sesión)** → Task 2 (`resolveOperador`) + Tasks 4, 6. ✅
- **Lista de operadores por sucursal (+ADMIN)** → Task 3. ✅
- **Ventas: vendedor seleccionable, comisión lo sigue** → Tasks 4, 5. ✅
- **Órdenes: recibido_por seleccionable + mostrado** → Tasks 6, 7, 8. ✅
- **Default = usuario de sesión** → Tasks 5, 7 (UI) + fallback server (2). ✅
- **No tocar audit; trazabilidad doble** → respetado (actor en registro, operador en audit existente). ✅
- **Sin PIN / sin tocar login** → ninguna task toca auth. ✅

**Puntos del spec resueltos en el plan:**
- `recibido_por` ausente → fallback `userId` de sesión (Task 6 Step 3), no null (no se pierde el dato).
- Endpoint reusado vs nuevo → se crea `/api/operadores` (los existentes no dan "cualquier usuario activo").

## Sugerencia de PRs (entrega)

- **PR 1 (fundación + POS vendedor):** Tasks 2, 3, 4, 5.
- **PR 2 (órdenes recibido_por):** Tasks 1, 6, 7, 8.

Cada PR es desplegable y testeable solo. La migración 260 se aplica a Supabase al mergear PR 2.
