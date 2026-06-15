# Upgrade de la lista de clientes (SP-A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar filtros, métricas por cliente (deuda pendiente, # órdenes, última visita) y modo deudores a la lista de clientes, sobre una nueva SQL view.

**Architecture:** Una VIEW `v_clientes_resumen` agrega `ordenes_servicio` por cliente. `GET /api/clientes` lee de la view, suma filtros y un `totalDeuda`. La UI (`clientes-list.tsx` + `cliente-mobile-card.tsx`) consume los campos nuevos: barra de filtros, columnas extra y barra de total adeudado.

**Tech Stack:** Next.js App Router, Supabase (`supabaseAdmin` + PostgREST), Zod, SWR, Vitest (tests de API), UI kit propio (`DataTable`, `Select`, `Switch`, `Input`, `Card`, `Badge`).

**Convención de tests:** Solo hay infra de test de API (`__tests__/api/` con vitest + `helpers.ts`). NO hay infra de test de componentes React, ni de SQL. Por lo tanto: la tarea de API usa TDD; la migración SQL y las tareas de UI se verifican con `npx tsc --noEmit` + `npm run build` + manual.

**Comandos:**
- Test puntual: `npm run test:run -- <ruta>`
- Todos: `npm run test:run`
- Typecheck: `npx tsc --noEmit` (error pre-existente conocido a ignorar: `__tests__/lib/csv-export.test.ts` Buffer)
- Build: `npm run build` (ruido pre-existente a ignorar: firebase-admin warning, Google Fonts network, superadmin DYNAMIC_SERVER_USAGE)

---

## File Structure

**Crear:**
- `supabase/migrations/225_v_clientes_resumen.sql` — la VIEW.
- `__tests__/api/clientes-filtros.test.ts` — tests de los filtros + totalDeuda + view.

**Modificar:**
- `app/api/clientes/route.ts` — GET lee de la view + filtros + totalDeuda + mapeo.
- `types/index.ts` — `Cliente` suma campos opcionales.
- `__tests__/api/clientes.test.ts` — ajustar el mock del GET de listado (ahora `from("v_clientes_resumen")`).
- `components/clientes/clientes-list.tsx` — barra de filtros, columnas nuevas, rename Saldo→Crédito, barra total adeudado.
- `components/clientes/cliente-mobile-card.tsx` — métricas nuevas.

---

## Task 1: Migración — VIEW `v_clientes_resumen`

**Files:**
- Create: `supabase/migrations/225_v_clientes_resumen.sql`

- [ ] **Step 1: Confirmar el número de migración**

Run: `ls supabase/migrations/ | grep -oE '^[0-9]+' | sort -n | tail -1`
Si el mayor NO es 224, usar `<mayor>+1` como prefijo en vez de 225 en el nombre del archivo (el resto del plan asume 225).

- [ ] **Step 2: Crear la migración**

Crear `supabase/migrations/225_v_clientes_resumen.sql`:

```sql
-- Vista de resumen por cliente: agrega ordenes_servicio para mostrar
-- # de órdenes, última visita y deuda pendiente en la lista de clientes.
CREATE OR REPLACE VIEW v_clientes_resumen AS
SELECT
  c.*,
  COALESCE(agg.ordenes_count, 0)   AS ordenes_count,
  agg.ultima_visita                AS ultima_visita,
  COALESCE(agg.deuda_pendiente, 0) AS deuda_pendiente
FROM clientes c
LEFT JOIN (
  SELECT
    cliente_id,
    COUNT(*)            AS ordenes_count,
    MAX(fecha_ingreso)  AS ultima_visita,
    SUM(
      CASE WHEN estado_cobro IN ('PENDIENTE','PARCIAL')
        THEN GREATEST(
          COALESCE(costo_final, 0)
          - COALESCE(descuento_cobro, 0)
          - COALESCE(total_cobrado, 0), 0)
        ELSE 0 END
    ) AS deuda_pendiente
  FROM ordenes_servicio
  GROUP BY cliente_id
) agg ON agg.cliente_id = c.id;
```

- [ ] **Step 3: Verificar sintaxis (build no la corre; revisar columnas)**

Confirmar que las columnas referenciadas existen leyendo migraciones previas:
- `ordenes_servicio`: `cliente_id`, `fecha_ingreso`, `estado_cobro`, `costo_final`, `descuento_cobro`, `total_cobrado` (ver `001_schema.sql` y `067_cobros_orden_caja.sql`).
- `clientes`: tiene `id`, `organization_id`, `tipo_cliente`, `acepta_whatsapp`, `created_at`, `saldo_cuenta`.

No hay forma automática de correr la migración acá (la aplica el usuario en prod). Dejar el archivo listo.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/225_v_clientes_resumen.sql
git commit -m "feat(db): 225 — vista v_clientes_resumen (agregados por cliente)"
```

---

## Task 2: API — GET lee de la view + filtros + totalDeuda + tipos

**Files:**
- Modify: `app/api/clientes/route.ts` (GET)
- Modify: `types/index.ts`
- Modify: `__tests__/api/clientes.test.ts`
- Test: `__tests__/api/clientes-filtros.test.ts` (nuevo)

- [ ] **Step 1: Extender el tipo `Cliente`**

En `types/index.ts`, dentro de `interface Cliente` (después de `saldoCuenta?: number`), agregar:

```ts
  deudaPendiente?: number
  ordenesCount?: number
  ultimaVisita?: string | null
```

- [ ] **Step 2: Escribir el test (TDD) — debe fallar**

Crear `__tests__/api/clientes-filtros.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  parseResponse,
} from "./helpers"

import { GET } from "@/app/api/clientes/route"

function mockRows() {
  return [
    { id: "c1", nombre: "Empresa SA", tipo_cliente: "EMPRESA", acepta_whatsapp: true, saldo_cuenta: "0", created_at: "2026-01-01", deuda_pendiente: "150.5", ordenes_count: 3, ultima_visita: "2026-05-01" },
  ]
}

describe("GET /api/clientes — filtros y resumen", () => {
  beforeEach(() => vi.clearAllMocks())

  it("lee de la vista v_clientes_resumen", async () => {
    mockAuthSuccess()
    const chain = createChainMock(mockRows(), null, 1)
    const fromSpy = mockSupabaseFrom({ v_clientes_resumen: chain })

    await GET(createGetRequest("http://localhost:3000/api/clientes"))

    expect(fromSpy).toHaveBeenCalledWith("v_clientes_resumen")
  })

  it("filtra por tipoCliente", async () => {
    mockAuthSuccess()
    const chain = createChainMock(mockRows(), null, 1)
    mockSupabaseFrom({ v_clientes_resumen: chain })

    await GET(createGetRequest("http://localhost:3000/api/clientes?tipoCliente=EMPRESA"))

    expect(chain.eq).toHaveBeenCalledWith("tipo_cliente", "EMPRESA")
  })

  it("filtra por conDeuda", async () => {
    mockAuthSuccess()
    const chain = createChainMock(mockRows(), null, 1)
    mockSupabaseFrom({ v_clientes_resumen: chain })

    await GET(createGetRequest("http://localhost:3000/api/clientes?conDeuda=true"))

    expect(chain.gt).toHaveBeenCalledWith("deuda_pendiente", 0)
  })

  it("filtra por fechaDesde y fechaHasta sobre created_at", async () => {
    mockAuthSuccess()
    const chain = createChainMock(mockRows(), null, 1)
    mockSupabaseFrom({ v_clientes_resumen: chain })

    await GET(createGetRequest("http://localhost:3000/api/clientes?fechaDesde=2026-01-01&fechaHasta=2026-02-01"))

    expect(chain.gte).toHaveBeenCalledWith("created_at", "2026-01-01T00:00:00")
    expect(chain.lte).toHaveBeenCalledWith("created_at", "2026-02-01T23:59:59")
  })

  it("filtra por aceptaWhatsapp=false", async () => {
    mockAuthSuccess()
    const chain = createChainMock(mockRows(), null, 1)
    mockSupabaseFrom({ v_clientes_resumen: chain })

    await GET(createGetRequest("http://localhost:3000/api/clientes?aceptaWhatsapp=false"))

    expect(chain.eq).toHaveBeenCalledWith("acepta_whatsapp", false)
  })

  it("sin filtros no aplica tipo/deuda/fecha/whatsapp", async () => {
    mockAuthSuccess()
    const chain = createChainMock(mockRows(), null, 1)
    mockSupabaseFrom({ v_clientes_resumen: chain })

    await GET(createGetRequest("http://localhost:3000/api/clientes"))

    const eqCalls = chain.eq.mock.calls.map((c) => c[0])
    expect(eqCalls).not.toContain("tipo_cliente")
    expect(eqCalls).not.toContain("acepta_whatsapp")
    expect(chain.gt).not.toHaveBeenCalled()
  })

  it("devuelve totalDeuda y los campos de resumen mapeados", async () => {
    mockAuthSuccess()
    const chain = createChainMock(mockRows(), null, 1)
    mockSupabaseFrom({ v_clientes_resumen: chain })

    const res = await GET(createGetRequest("http://localhost:3000/api/clientes"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.totalDeuda).toBe(150.5)
    expect(body.data[0].deudaPendiente).toBe(150.5)
    expect(body.data[0].ordenesCount).toBe(3)
    expect(body.data[0].ultimaVisita).toBe("2026-05-01")
  })
})
```

Nota sobre el mock: `mockSupabaseFrom` devuelve el MISMO `chain` para cada `from("v_clientes_resumen")`. El GET hará dos lecturas a la view (listado paginado + agregado de `totalDeuda`); ambas comparten el chain y resuelven a `mockRows()`. Por eso `totalDeuda` = suma de `deuda_pendiente` de las filas (150.5). `mockSupabaseFrom` debe devolver el spy de `from`; si la versión actual no lo retorna, capturar vía `vi.mocked(supabaseAdmin.from)` dentro del test (ver Step 3).

- [ ] **Step 3: Verificar que `mockSupabaseFrom` retorna el spy**

Leer `__tests__/api/helpers.ts`. Si `mockSupabaseFrom` NO retorna el mock de `from`, en el test 1 reemplazar:
```ts
const fromSpy = mockSupabaseFrom({ v_clientes_resumen: chain })
```
por:
```ts
import { supabaseAdmin } from "@/lib/supabase"
mockSupabaseFrom({ v_clientes_resumen: chain })
const fromSpy = vi.mocked(supabaseAdmin.from)
```
(Usar lo que corresponda según el helper real.)

- [ ] **Step 4: Correr el test — debe FALLAR**

Run: `npm run test:run -- __tests__/api/clientes-filtros.test.ts`
Esperado: fallan (el GET aún usa `from("clientes")`, no aplica filtros nuevos, no devuelve `totalDeuda`).

- [ ] **Step 5: Implementar en `app/api/clientes/route.ts` (GET)**

Reemplazar el cuerpo del `GET` (desde la lectura de params hasta el `return`) por esta versión. Mantener imports y el `POST` sin cambios:

```ts
export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search") || ""
    const tipoCliente = searchParams.get("tipoCliente") || ""
    const conDeuda = searchParams.get("conDeuda") === "true"
    const fechaDesde = searchParams.get("fechaDesde") || ""
    const fechaHasta = searchParams.get("fechaHasta") || ""
    const aceptaWhatsappParam = searchParams.get("aceptaWhatsapp")

    const page = parseInt(searchParams.get("page") || "1")
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100)
    const offset = (page - 1) * limit

    const sortByParam = searchParams.get("sortBy") || "createdAt"
    const sortMap: Record<string, string> = {
      createdAt: "created_at",
      nombre: "nombre",
      telefono: "telefono",
      email: "email",
      deudaPendiente: "deuda_pendiente",
      ordenes: "ordenes_count",
      ultimaVisita: "ultima_visita",
    }
    const sortBy = sortMap[sortByParam] || "created_at"
    const sortOrder = searchParams.get("sortOrder") === "asc"

    // Helper para aplicar los mismos filtros a cualquier builder sobre la vista
    const applyFilters = (q: any) => {
      let query = q.eq("organization_id", organizationId!)
      if (search) {
        query = query.or(
          `nombre.ilike.%${search}%,telefono.ilike.%${search}%,dni.ilike.%${search}%,email.ilike.%${search}%`
        )
      }
      if (tipoCliente) query = query.eq("tipo_cliente", tipoCliente)
      if (conDeuda) query = query.gt("deuda_pendiente", 0)
      if (fechaDesde) query = query.gte("created_at", `${fechaDesde}T00:00:00`)
      if (fechaHasta) query = query.lte("created_at", `${fechaHasta}T23:59:59`)
      if (aceptaWhatsappParam === "true") query = query.eq("acepta_whatsapp", true)
      if (aceptaWhatsappParam === "false") query = query.eq("acepta_whatsapp", false)
      return query
    }

    // Listado paginado
    let listQuery = applyFilters(
      supabaseAdmin.from("v_clientes_resumen").select("*", { count: "exact" })
    )
      .order(sortBy, { ascending: sortOrder })
      .range(offset, offset + limit - 1)

    const { data: clientes, error: dbError, count } = await listQuery
    if (dbError) throw dbError

    // Total adeudado del set filtrado (sin paginar)
    let totalDeuda = 0
    try {
      const { data: deudaRows } = await applyFilters(
        supabaseAdmin.from("v_clientes_resumen").select("deuda_pendiente")
      )
      totalDeuda = (deudaRows || []).reduce(
        (acc: number, r: any) => acc + parseFloat(r.deuda_pendiente || "0"),
        0
      )
    } catch (e) {
      console.error("Error calculando totalDeuda:", e)
    }

    return NextResponse.json({
      data: (clientes || []).map((c: any) => ({
        ...formatCliente(c),
        deudaPendiente: parseFloat(c.deuda_pendiente || "0"),
        ordenesCount: c.ordenes_count ?? 0,
        ultimaVisita: c.ultima_visita ?? null,
      })),
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
      totalDeuda,
    }, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    })
  } catch (error) {
    console.error("Error fetching clientes:", error)
    return NextResponse.json(
      { error: "Error al obtener clientes" },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 6: Ajustar el test existente `__tests__/api/clientes.test.ts`**

El GET de listado ahora usa `from("v_clientes_resumen")`. En `clientes.test.ts`, los tests del bloque `describe("GET /api/clientes")` que hacen `mockSupabaseFrom({ clientes: chain })` deben pasar a `mockSupabaseFrom({ v_clientes_resumen: chain })` para el GET. (Los del POST siguen con `{ clientes: chain }`.) Revisar cada test del GET y cambiar la key de la tabla. No cambiar las aserciones de negocio (status, body.data, total).

- [ ] **Step 7: Correr ambos archivos — deben PASAR**

Run: `npm run test:run -- __tests__/api/clientes-filtros.test.ts __tests__/api/clientes.test.ts`
Esperado: todos verdes.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Esperado: sin errores nuevos (ignorar csv-export.test.ts Buffer).

- [ ] **Step 9: Commit**

```bash
git add app/api/clientes/route.ts types/index.ts __tests__/api/clientes-filtros.test.ts __tests__/api/clientes.test.ts
git commit -m "feat(clientes): GET lee de v_clientes_resumen + filtros + totalDeuda"
```

---

## Task 3: UI — barra de filtros en la lista

**Files:**
- Modify: `components/clientes/clientes-list.tsx`

Contexto: el componente usa SWR con `apiUrl` construido por `useMemo` a partir de `debouncedSearch`, `page`, `pageSize`, `sortKey`, `sortDirection` (ver el `useMemo` de `apiUrl`). Hay que sumar estados de filtro y meterlos en esa URL.

- [ ] **Step 1: Estado de filtros + URL**

En `ClientesList`, agregar estados (junto a `search`):

```tsx
const [tipoCliente, setTipoCliente] = useState<string>("")        // "", "INDIVIDUAL", "EMPRESA"
const [conDeuda, setConDeuda] = useState(false)
const [aceptaWhatsapp, setAceptaWhatsapp] = useState<string>("")  // "", "true", "false"
const [fechaDesde, setFechaDesde] = useState<string>("")
const [fechaHasta, setFechaHasta] = useState<string>("")
```

En el `useMemo` que arma `apiUrl`, agregar los params (y agregarlos al array de dependencias):

```tsx
if (tipoCliente) params.append("tipoCliente", tipoCliente)
if (conDeuda) params.append("conDeuda", "true")
if (aceptaWhatsapp) params.append("aceptaWhatsapp", aceptaWhatsapp)
if (fechaDesde) params.append("fechaDesde", fechaDesde)
if (fechaHasta) params.append("fechaHasta", fechaHasta)
```
Dependencias del useMemo: añadir `tipoCliente, conDeuda, aceptaWhatsapp, fechaDesde, fechaHasta`.

Cada setter de filtro debe resetear page a 1. Crear un wrapper:
```tsx
const onFilterChange = (fn: () => void) => { fn(); setPage(1) }
```
y usarlo en los `onChange` (p.ej. `onFilterChange(() => setTipoCliente(v))`).

- [ ] **Step 2: Leer `totalDeuda` del response**

Donde se extrae `data`/`total` del SWR (`const clientes = data?.data ...`), agregar:
```tsx
const totalDeuda: number = data?.totalDeuda || 0
```

- [ ] **Step 3: Renderizar la barra de filtros**

Debajo del input de búsqueda (dentro del header de filtros), agregar una fila con los controles. Usar el `Select` del proyecto (`@/components/ui/select`) y el `Switch` (`@/components/ui/switch`) — leer un ejemplo de uso real de `Select` en el repo (p.ej. en `components/ordenes/ordenes-list.tsx` o cualquier filtro existente) para respetar el patrón `Select/SelectTrigger/SelectContent/SelectItem`. Para fechas usar inputs nativos `type="date"` (como en `components/caja/historial-cierres.tsx`). Estructura:

```tsx
<div className="flex flex-wrap items-end gap-2">
  {/* Tipo */}
  <Select value={tipoCliente || "TODOS"} onValueChange={(v) => onFilterChange(() => setTipoCliente(v === "TODOS" ? "" : v))}>
    <SelectTrigger className="w-[150px]"><SelectValue placeholder="Tipo" /></SelectTrigger>
    <SelectContent>
      <SelectItem value="TODOS">Todos los tipos</SelectItem>
      <SelectItem value="INDIVIDUAL">Individual</SelectItem>
      <SelectItem value="EMPRESA">Empresa</SelectItem>
    </SelectContent>
  </Select>

  {/* Acepta WhatsApp */}
  <Select value={aceptaWhatsapp || "TODOS"} onValueChange={(v) => onFilterChange(() => setAceptaWhatsapp(v === "TODOS" ? "" : v))}>
    <SelectTrigger className="w-[170px]"><SelectValue placeholder="WhatsApp" /></SelectTrigger>
    <SelectContent>
      <SelectItem value="TODOS">WhatsApp: todos</SelectItem>
      <SelectItem value="true">Acepta WhatsApp</SelectItem>
      <SelectItem value="false">No acepta</SelectItem>
    </SelectContent>
  </Select>

  {/* Fecha alta */}
  <input type="date" value={fechaDesde} onChange={(e) => onFilterChange(() => setFechaDesde(e.target.value))} className="h-9 rounded-md border border-input bg-background px-2 text-sm" aria-label="Fecha desde" />
  <input type="date" value={fechaHasta} onChange={(e) => onFilterChange(() => setFechaHasta(e.target.value))} className="h-9 rounded-md border border-input bg-background px-2 text-sm" aria-label="Fecha hasta" />

  {/* Con deuda */}
  <label className="flex items-center gap-2 text-sm">
    <Switch checked={conDeuda} onCheckedChange={(v) => onFilterChange(() => setConDeuda(!!v))} />
    Solo con deuda
  </label>

  {/* Limpiar */}
  {(tipoCliente || conDeuda || aceptaWhatsapp || fechaDesde || fechaHasta) && (
    <Button variant="ghost" size="sm" onClick={() => onFilterChange(() => { setTipoCliente(""); setConDeuda(false); setAceptaWhatsapp(""); setFechaDesde(""); setFechaHasta("") })}>
      Limpiar
    </Button>
  )}
</div>
```
Agregar los imports: `Select, SelectContent, SelectItem, SelectTrigger, SelectValue` de `@/components/ui/select` y `Switch` de `@/components/ui/switch`. Verificar los nombres exactos de export leyendo esos archivos.

- [ ] **Step 4: Barra "Total adeudado" (solo con deuda activo)**

Encima de la tabla, cuando `conDeuda` está activo:
```tsx
{conDeuda && (
  <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm">
    <span className="text-muted-foreground">Total adeudado:</span>
    <span className="font-semibold text-destructive tabular-nums">{formatPrice(totalDeuda)}</span>
  </div>
)}
```
(`formatPrice` ya viene de `useCurrency()` en este componente.)

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit`
Run: `npm run build`
Esperado: sin errores nuevos; "Compiled successfully".

- [ ] **Step 6: Commit**

```bash
git add components/clientes/clientes-list.tsx
git commit -m "feat(clientes): barra de filtros y total adeudado en la lista"
```

---

## Task 4: UI — columnas enriquecidas (desktop)

**Files:**
- Modify: `components/clientes/clientes-list.tsx`

- [ ] **Step 1: Rename "Saldo" → "Crédito"**

En el array `columns`, la columna `key: "saldoCuenta"` con `header: "Saldo"`: cambiar `header` a `"Crédito"`. Dejar el render igual (muestra `saldoCuenta`).

- [ ] **Step 2: Agregar columnas Deuda, # Órdenes, Última visita**

Agregar al array `columns` (antes de la columna `actions`):

```tsx
{
  key: "deudaPendiente",
  header: "Deuda",
  sortable: true,
  hideOnTablet: true,
  render: (cliente) => {
    const d = cliente.deudaPendiente || 0
    if (d <= 0) return <span className="text-muted-foreground">-</span>
    return <span className="font-medium text-destructive tabular-nums">{formatPrice(d)}</span>
  },
},
{
  key: "ordenes",
  header: "Órdenes",
  sortable: true,
  hideOnMobile: true,
  render: (cliente) => <span className="tabular-nums">{cliente.ordenesCount ?? 0}</span>,
},
{
  key: "ultimaVisita",
  header: "Última visita",
  sortable: true,
  hideOnMobile: true,
  render: (cliente) => cliente.ultimaVisita ? formatDate(cliente.ultimaVisita) : <span className="text-muted-foreground">-</span>,
},
```
Nota: `sortable` columns usan el `handleSort(key)` ya existente; las keys `deudaPendiente`/`ordenes`/`ultimaVisita` coinciden con el `sortMap` del API (Task 2). `formatDate` ya viene de `useCurrency()`.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit` ; `npm run build`
Esperado: sin errores nuevos; compila.

- [ ] **Step 4: Commit**

```bash
git add components/clientes/clientes-list.tsx
git commit -m "feat(clientes): columnas deuda, ordenes y ultima visita"
```

---

## Task 5: UI — métricas en la card mobile

**Files:**
- Modify: `components/clientes/cliente-mobile-card.tsx`

- [ ] **Step 1: Mostrar deuda / # órdenes / última visita**

En el bloque "Info" de la card (después de la fila de dirección / fecha registrado), agregar:

```tsx
{(cliente.deudaPendiente ?? 0) > 0 && (
  <div className="flex items-center gap-2 text-destructive font-medium">
    <PiggyBank className="h-3.5 w-3.5 shrink-0" />
    <span>Debe: {formatPrice(cliente.deudaPendiente || 0)}</span>
  </div>
)}
<div className="flex items-center gap-3 text-xs text-muted-foreground pt-0.5">
  <span>{cliente.ordenesCount ?? 0} órdenes</span>
  {cliente.ultimaVisita && <span>· Última: {formatDate(cliente.ultimaVisita)}</span>}
</div>
```
Agregar `formatPrice` al destructuring de `useCurrency()` (hoy la card solo trae `formatDate`): `const { formatDate, formatPrice } = useCurrency()`. `PiggyBank` ya se importa de lucide en este archivo (verificar; si no, agregarlo).

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit` ; `npm run build`
Esperado: sin errores nuevos; compila.

- [ ] **Step 3: Commit**

```bash
git add components/clientes/cliente-mobile-card.tsx
git commit -m "feat(clientes): metricas de deuda y ordenes en card mobile"
```

---

## Task 6: Verificación final

- [ ] **Step 1: Suite completa**

Run: `npm run test:run`
Esperado: todo verde, incluido `clientes-filtros.test.ts` y `clientes.test.ts` ajustado.

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit` (solo csv-export Buffer pre-existente)
Run: `npm run build` ("Compiled successfully")

- [ ] **Step 3: Recorrido manual (requiere la migración 225 aplicada)**

Aplicar `225_v_clientes_resumen.sql` en la DB de desarrollo. Luego en `/clientes`:
- Filtrar por tipo Empresa → solo empresas.
- Toggle "Solo con deuda" → solo clientes con `deuda_pendiente > 0`; aparece barra "Total adeudado".
- Filtrar por fecha de alta.
- Filtrar acepta-WhatsApp.
- Ver columnas Crédito / Deuda / Órdenes / Última visita; ordenar por Deuda.
- Card mobile muestra deuda/órdenes/última visita.

NOTA: sin la migración aplicada, el endpoint fallará (la view no existe). Si no se puede aplicar la migración en el entorno de verificación, dejarlo documentado como paso pendiente para el usuario.

- [ ] **Step 4: Commit final (si quedó algo suelto)**

```bash
git add -A
git commit -m "chore(clientes): ajustes finales upgrade de lista"
```

---

## Self-Review (completado)

- **Cobertura del spec:** view (T1), GET view+filtros+totalDeuda+tipos (T2), barra de filtros + total adeudado (T3), columnas + rename Saldo→Crédito (T4), card mobile (T5), verificación (T6). Todas las secciones del spec tienen tarea.
- **Placeholders:** ninguno; código completo en cada step.
- **Consistencia de tipos:** keys de sort (`deudaPendiente`/`ordenes`/`ultimaVisita`) iguales en `sortMap` (T2) y en las columnas sortables (T4). Campos `deudaPendiente`/`ordenesCount`/`ultimaVisita` definidos en el tipo (T2 Step 1) y consumidos en T3/T4/T5. Respuesta API agrega `totalDeuda`, consumido en T3.
- **Riesgos marcados con step de verificación:** número de migración (T1 S1), retorno del spy en `mockSupabaseFrom` (T2 S3), exports reales de `Select`/`Switch` (T3 S3), import de `PiggyBank` en la card (T5 S1), migración aplicada para la verificación manual (T6 S3).
- **Dependencia operativa:** el endpoint depende de la view; sin la migración aplicada, falla. Documentado en T6.
