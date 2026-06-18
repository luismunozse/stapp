# Catálogo Fase 3 — Búsqueda server-side + paginación — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Migrar la lista de items del admin a búsqueda server-side (nombre + SKU de variante + código de inventario) y paginación, siguiendo las convenciones del repo.

**Architecture:** Refactor del `GET /api/catalogo/items` (paginación + count + búsqueda multi-fuente con 2 pre-queries y un `.or`), un endpoint nuevo `/api/catalogo/items/meta` para agregados (tags + contador sin-foto), y refactor de `catalogo-items-tab.tsx` a fetch server-driven con debounce y controles de paginación. Helpers puros (`buildItemsQuery`, `useDebouncedValue`) extraídos y testeados.

**Tech Stack:** Next.js route handlers, Supabase (PostgREST), TS, vitest 4 + @testing-library/react. API tests con los helpers de `__tests__/api/helpers.ts` (`mockAuthSuccess`, `createChainMock(data,error,count)`, `mockSupabaseFrom`/per-table, `createGetRequest`, `parseResponse`).

**Spec:** `docs/superpowers/specs/2026-06-18-catalogo-fase3-busqueda-paginacion-design.md`

---

## Convenciones
- `npx vitest run <ruta>`. jsdom, globals. API tests mockean `supabaseAdmin.from`.
- Paginación: `parsePagination(searchParams)` de `lib/api-utils.ts` (default 20, max 100), respuesta `{ items, total, page, limit, totalPages }`.
- Conventional commits, SIN AI attribution.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `lib/catalogo/items-query.ts` (nuevo) | `buildItemsQuery(params)` → querystring. |
| `components/catalogo/use-debounced-value.ts` (nuevo) | Hook `useDebouncedValue(value, delay)`. |
| `app/api/catalogo/items/route.ts` (modificar) | GET con paginación + count + búsqueda 2-pre-queries + `.or`. |
| `app/api/catalogo/items/meta/route.ts` (nuevo) | GET `{ tags, sinImagenCount }`. |
| `components/catalogo/catalogo-items-tab.tsx` (modificar) | Fetch server-driven, debounce, paginación UI, meta, reglas de reorder. |

---

## Task 1: `buildItemsQuery` (`lib/catalogo/items-query.ts`)

**Files:**
- Create: `lib/catalogo/items-query.ts`
- Test: `__tests__/lib/catalogo-items-query.test.ts`

- [ ] **Step 1: Failing test**

```ts
// __tests__/lib/catalogo-items-query.test.ts
import { describe, it, expect } from "vitest"
import { buildItemsQuery } from "@/lib/catalogo/items-query"

describe("buildItemsQuery", () => {
  it("omits empty params", () => {
    expect(buildItemsQuery({})).toBe("")
  })
  it("sets present filters", () => {
    const qs = buildItemsQuery({ q: "nokia", tipo: "PRODUCTO", categoriaId: "c1", estado: "activo", sinImagen: true })
    const sp = new URLSearchParams(qs)
    expect(sp.get("q")).toBe("nokia")
    expect(sp.get("tipo")).toBe("PRODUCTO")
    expect(sp.get("categoria_id")).toBe("c1")
    expect(sp.get("estado")).toBe("activo")
    expect(sp.get("sin_imagen")).toBe("1")
  })
  it("trims q and omits if blank", () => {
    expect(buildItemsQuery({ q: "   " })).toBe("")
    expect(new URLSearchParams(buildItemsQuery({ q: "  hola " })).get("q")).toBe("hola")
  })
  it("only includes page when > 1", () => {
    expect(new URLSearchParams(buildItemsQuery({ page: 1 })).has("page")).toBe(false)
    expect(new URLSearchParams(buildItemsQuery({ page: 3 })).get("page")).toBe("3")
  })
  it("includes limit when provided", () => {
    expect(new URLSearchParams(buildItemsQuery({ limit: 50 })).get("limit")).toBe("50")
  })
})
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement**

```ts
// lib/catalogo/items-query.ts
export interface ItemsQueryParams {
  q?: string
  tipo?: string
  categoriaId?: string
  estado?: string
  sinImagen?: boolean
  page?: number
  limit?: number
}

/** Arma el querystring para GET /api/catalogo/items, omitiendo params vacíos. */
export function buildItemsQuery(p: ItemsQueryParams): string {
  const sp = new URLSearchParams()
  const q = p.q?.trim()
  if (q) sp.set("q", q)
  if (p.tipo) sp.set("tipo", p.tipo)
  if (p.categoriaId) sp.set("categoria_id", p.categoriaId)
  if (p.estado) sp.set("estado", p.estado)
  if (p.sinImagen) sp.set("sin_imagen", "1")
  if (p.page && p.page > 1) sp.set("page", String(p.page))
  if (p.limit) sp.set("limit", String(p.limit))
  return sp.toString()
}
```

- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit**
```bash
git add lib/catalogo/items-query.ts __tests__/lib/catalogo-items-query.test.ts
git commit -m "feat(catalogo): buildItemsQuery helper para la lista de items"
```

---

## Task 2: `useDebouncedValue` (`components/catalogo/use-debounced-value.ts`)

**Files:**
- Create: `components/catalogo/use-debounced-value.ts`
- Test: `__tests__/components/use-debounced-value.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
// __tests__/components/use-debounced-value.test.tsx
import { describe, it, expect, vi, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useDebouncedValue } from "@/components/catalogo/use-debounced-value"

afterEach(() => vi.useRealTimers())

describe("useDebouncedValue", () => {
  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebouncedValue("a", 300))
    expect(result.current).toBe("a")
  })
  it("updates only after the delay", () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), { initialProps: { v: "a" } })
    rerender({ v: "ab" })
    expect(result.current).toBe("a")
    act(() => { vi.advanceTimersByTime(299) })
    expect(result.current).toBe("a")
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current).toBe("ab")
  })
  it("resets the timer on rapid changes (only last value wins)", () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), { initialProps: { v: "a" } })
    rerender({ v: "ab" })
    act(() => { vi.advanceTimersByTime(200) })
    rerender({ v: "abc" })
    act(() => { vi.advanceTimersByTime(200) })
    expect(result.current).toBe("a")
    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current).toBe("abc")
  })
})
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement**

```ts
// components/catalogo/use-debounced-value.ts
"use client"

import { useEffect, useState } from "react"

export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}
```

- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit**
```bash
git add components/catalogo/use-debounced-value.ts __tests__/components/use-debounced-value.test.tsx
git commit -m "feat(catalogo): useDebouncedValue hook"
```

---

## Task 3: `GET /api/catalogo/items` — paginación + búsqueda multi-fuente

**Files:**
- Modify: `app/api/catalogo/items/route.ts`
- Test: `__tests__/api/catalogo-items-search.test.ts`

Solo se modifica el handler `GET`. NO tocar `POST`.

- [ ] **Step 1: Failing test**

```ts
// __tests__/api/catalogo-items-search.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, mockAuthError, createChainMock, createGetRequest, parseResponse } from "./helpers"
import { GET } from "@/app/api/catalogo/items/route"

function mockTables(chains: Record<string, any>) {
  vi.mocked(supabaseAdmin.from).mockImplementation((t: string) =>
    (chains[t] || createChainMock(null, { message: `no mock ${t}` })) as any)
}

const BASE = "http://localhost:3000/api/catalogo/items"

describe("GET /api/catalogo/items — search + pagination", () => {
  beforeEach(() => vi.clearAllMocks())

  it("401 when unauthenticated", async () => {
    mockAuthError()
    const res = await GET(createGetRequest(BASE))
    expect((await parseResponse(res)).status).toBe(401)
  })

  it("no q: queries items with range + returns pagination meta", async () => {
    mockAuthSuccess()
    const itemsChain = createChainMock([{ id: "i1" }], null, 1)
    mockTables({ catalogo_items: itemsChain })

    const res = await GET(createGetRequest(`${BASE}?page=2&limit=20`))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(itemsChain.range).toHaveBeenCalledWith(20, 39)
    expect(body).toMatchObject({ total: 1, page: 2, limit: 20, totalPages: 1 })
    expect(Array.isArray(body.items)).toBe(true)
  })

  it("q matches name only when no variant/inventario hits → ilike on nombre", async () => {
    mockAuthSuccess()
    const variantes = createChainMock([])
    const inventario = createChainMock([])
    const itemsChain = createChainMock([], null, 0)
    mockTables({ catalogo_variantes: variantes, inventario, catalogo_items: itemsChain })

    await GET(createGetRequest(`${BASE}?q=nokia`))
    expect(itemsChain.ilike).toHaveBeenCalledWith("nombre", "%nokia%")
    expect(itemsChain.or).not.toHaveBeenCalled()
  })

  it("q matches a variant SKU → .or includes id.in", async () => {
    mockAuthSuccess()
    const variantes = createChainMock([{ item_id: "itemA" }])
    const inventario = createChainMock([])
    const itemsChain = createChainMock([], null, 0)
    mockTables({ catalogo_variantes: variantes, inventario, catalogo_items: itemsChain })

    await GET(createGetRequest(`${BASE}?q=SKU123`))
    expect(itemsChain.or).toHaveBeenCalledTimes(1)
    const filter = itemsChain.or.mock.calls[0][0] as string
    expect(filter).toContain("nombre.ilike.%SKU123%")
    expect(filter).toContain("id.in.(itemA)")
  })

  it("q matches an inventario codigo → .or includes inventario_id.in", async () => {
    mockAuthSuccess()
    const variantes = createChainMock([])
    const inventario = createChainMock([{ id: "invB" }])
    const itemsChain = createChainMock([], null, 0)
    mockTables({ catalogo_variantes: variantes, inventario, catalogo_items: itemsChain })

    await GET(createGetRequest(`${BASE}?q=COD9`))
    const filter = itemsChain.or.mock.calls[0][0] as string
    expect(filter).toContain("inventario_id.in.(invB)")
  })

  it("sanitizes dangerous chars in q", async () => {
    mockAuthSuccess()
    const variantes = createChainMock([])
    const inventario = createChainMock([])
    const itemsChain = createChainMock([], null, 0)
    mockTables({ catalogo_variantes: variantes, inventario, catalogo_items: itemsChain })

    await GET(createGetRequest(`${BASE}?q=${encodeURIComponent("a,b)(*")}`))
    const arg = itemsChain.ilike.mock.calls[0]?.[1] as string
    expect(arg).not.toContain(",")
    expect(arg).not.toContain(")")
    expect(arg).not.toContain("(")
    expect(arg).not.toContain("*")
  })

  it("applies tipo + estado + sin_imagen filters and scopes by org", async () => {
    mockAuthSuccess()
    const itemsChain = createChainMock([], null, 0)
    mockTables({ catalogo_items: itemsChain })

    await GET(createGetRequest(`${BASE}?tipo=PRODUCTO&estado=inactivo&sin_imagen=1`))
    expect(itemsChain.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(itemsChain.eq).toHaveBeenCalledWith("tipo", "PRODUCTO")
    expect(itemsChain.eq).toHaveBeenCalledWith("activo", false)
    expect(itemsChain.is).toHaveBeenCalledWith("imagen_url", null)
  })
})
```

- [ ] **Step 2: Run, verify FAIL** (current GET has no pagination/2-step).
Run: `npx vitest run __tests__/api/catalogo-items-search.test.ts`

- [ ] **Step 3: Implement — replace ONLY the `GET` function**

Add import at the top (keep existing imports):
```ts
import { parsePagination } from "@/lib/api-utils"
```
Replace the whole `GET` handler with:
```ts
export async function GET(req: Request) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const org = auth.organizationId!

  const url = new URL(req.url)
  const categoriaId = url.searchParams.get("categoria_id")
  const tipo = url.searchParams.get("tipo")
  const estado = url.searchParams.get("estado")
  const sinImagen = url.searchParams.get("sin_imagen") === "1"
  const rawQ = url.searchParams.get("q")?.trim() ?? ""
  const q = rawQ.replace(/[,()%_*\\]/g, " ").replace(/\s+/g, " ").trim()
  const { page, limit, offset } = parsePagination(url.searchParams)

  // Step 1: resolve cross-table matches (variant SKU, inventario codigo)
  let varItemIds: string[] = []
  let invIds: string[] = []
  if (q) {
    const [varsRes, invsRes] = await Promise.all([
      supabaseAdmin.from("catalogo_variantes").select("item_id").eq("organization_id", org).ilike("sku", `%${q}%`),
      supabaseAdmin.from("inventario").select("id").eq("organization_id", org).ilike("codigo", `%${q}%`),
    ])
    varItemIds = Array.from(new Set((varsRes.data ?? []).map((v: { item_id: string }) => v.item_id)))
    invIds = Array.from(new Set((invsRes.data ?? []).map((i: { id: string }) => i.id)))
  }

  // Step 2: main paginated query
  let query = supabaseAdmin
    .from("catalogo_items")
    .select("*, categoria:catalogo_categorias(id,nombre), inventario:inventario(id,stock,nombre)", { count: "exact" })
    .eq("organization_id", org)

  if (categoriaId) query = query.eq("categoria_id", categoriaId)
  if (tipo === "PRODUCTO" || tipo === "SERVICIO") query = query.eq("tipo", tipo)
  if (estado === "activo") query = query.eq("activo", true)
  else if (estado === "inactivo") query = query.eq("activo", false)
  if (sinImagen) query = query.is("imagen_url", null)

  if (q) {
    const orParts = [`nombre.ilike.%${q}%`]
    if (varItemIds.length > 0) orParts.push(`id.in.(${varItemIds.join(",")})`)
    if (invIds.length > 0) orParts.push(`inventario_id.in.(${invIds.join(",")})`)
    if (orParts.length === 1) query = query.ilike("nombre", `%${q}%`)
    else query = query.or(orParts.join(","))
  }

  query = query
    .order("orden", { ascending: true })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const total = count ?? 0
  return NextResponse.json({ items: data ?? [], total, page, limit, totalPages: Math.ceil(total / limit) })
}
```

- [ ] **Step 4: Run, verify PASS (7/7).**

- [ ] **Step 5: Verify the existing items API test still passes (if any references the old `{ items }` shape).**
Run: `npx vitest run __tests__/api/ 2>&1 | tail -20` — confirm no regression (the response still has `items`; it now ALSO has total/page/limit/totalPages — additive).

- [ ] **Step 6: Commit**
```bash
git add app/api/catalogo/items/route.ts __tests__/api/catalogo-items-search.test.ts
git commit -m "feat(catalogo): búsqueda server-side (nombre+SKU+código) y paginación en items GET"
```

---

## Task 4: `GET /api/catalogo/items/meta`

**Files:**
- Create: `app/api/catalogo/items/meta/route.ts`
- Test: `__tests__/api/catalogo-items-meta.test.ts`

- [ ] **Step 1: Failing test**

```ts
// __tests__/api/catalogo-items-meta.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, mockAuthError, createChainMock, parseResponse } from "./helpers"
import { GET } from "@/app/api/catalogo/items/meta/route"

function mockTablesSeq(tagsChain: any, sinImgChain: any) {
  let call = 0
  vi.mocked(supabaseAdmin.from).mockImplementation(() => (call++ === 0 ? tagsChain : sinImgChain) as any)
}

describe("GET /api/catalogo/items/meta", () => {
  beforeEach(() => vi.clearAllMocks())

  it("401 when unauthenticated", async () => {
    mockAuthError()
    const res = await GET()
    expect((await parseResponse(res)).status).toBe(401)
  })

  it("returns deduped sorted tags and sinImagenCount", async () => {
    mockAuthSuccess()
    const tagsChain = createChainMock([
      { etiquetas: ["rojo", "oferta"] },
      { etiquetas: ["rojo", "nuevo"] },
      { etiquetas: null },
    ])
    const sinImgChain = createChainMock(null, null, 4)
    mockTablesSeq(tagsChain, sinImgChain)

    const res = await GET()
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.tags).toEqual(["nuevo", "oferta", "rojo"])
    expect(body.sinImagenCount).toBe(4)
  })
})
```

- [ ] **Step 2: Run, verify FAIL** (module not found).

- [ ] **Step 3: Implement**

```ts
// app/api/catalogo/items/meta/route.ts
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const org = auth.organizationId!

  const [tagsRes, sinImgRes] = await Promise.all([
    supabaseAdmin.from("catalogo_items").select("etiquetas").eq("organization_id", org),
    supabaseAdmin
      .from("catalogo_items")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org)
      .eq("activo", true)
      .is("imagen_url", null),
  ])

  const tags = Array.from(
    new Set((tagsRes.data ?? []).flatMap((r: { etiquetas: string[] | null }) => r.etiquetas ?? [])),
  ).sort((a, b) => a.localeCompare(b))

  return NextResponse.json({ tags, sinImagenCount: sinImgRes.count ?? 0 })
}
```

- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit**
```bash
git add app/api/catalogo/items/meta/route.ts __tests__/api/catalogo-items-meta.test.ts
git commit -m "feat(catalogo): endpoint meta (tags + contador sin-foto)"
```

---

## Task 5: Refactor `catalogo-items-tab.tsx` a server-driven

**Files:**
- Modify: `components/catalogo/catalogo-items-tab.tsx`

Sin test nuevo (lógica testeada en T1/T2/T3/T4). Verificar tsc + eslint + build + manual. READ the file fully first; the change is pervasive. Apply carefully.

- [ ] **Step 1: Imports + estado de paginación/meta**

Agregar imports:
```tsx
import { buildItemsQuery } from "@/lib/catalogo/items-query"
import { useDebouncedValue } from "./use-debounced-value"
import { ChevronLeft, ChevronRight } from "lucide-react"
```
Agregar estado (junto a los existentes):
```tsx
const PAGE_SIZE = 20
const [page, setPage] = useState(1)
const [total, setTotal] = useState(0)
const [totalPages, setTotalPages] = useState(1)
const [tagSuggestions, setTagSuggestions] = useState<string[]>([])
const [sinImagenCount, setSinImagenCount] = useState(0)
const debouncedSearch = useDebouncedValue(search, 300)
```

- [ ] **Step 2: Reemplazar `load` por fetch server-driven + meta**

Reemplazar la función `load` (que hoy hace `fetch("/api/catalogo/items")` + categorías y filtra client-side) por:
```tsx
const loadCategorias = async () => {
  const res = await fetch("/api/catalogo/categorias")
  const data = await res.json()
  setCategorias(data.categorias ?? [])
}

const loadMeta = async () => {
  try {
    const res = await fetch("/api/catalogo/items/meta")
    const data = await res.json()
    setTagSuggestions(data.tags ?? [])
    setSinImagenCount(data.sinImagenCount ?? 0)
  } catch { /* noop */ }
}

const load = async () => {
  setLoading(true)
  try {
    const qs = buildItemsQuery({
      q: debouncedSearch,
      tipo: filterTipo,
      categoriaId: filterCategoria,
      estado: filterEstado,
      sinImagen: onlyMissingImage,
      page,
      limit: PAGE_SIZE,
    })
    const res = await fetch(`/api/catalogo/items${qs ? `?${qs}` : ""}`)
    const data = await res.json()
    setItems(data.items ?? [])
    setTotal(data.total ?? 0)
    setTotalPages(data.totalPages ?? 1)
  } catch {
    toast.error("Error cargando catálogo")
  } finally {
    setLoading(false)
  }
}
```

- [ ] **Step 3: Effects**

Reemplazar el `useEffect(() => { load() }, [])` por:
```tsx
// categorías + meta una vez
useEffect(() => { loadCategorias(); loadMeta() }, [])

// resetear a page 1 cuando cambian búsqueda/filtros
useEffect(() => {
  setPage(1)
}, [debouncedSearch, filterTipo, filterCategoria, filterEstado, onlyMissingImage])

// recargar la lista cuando cambian filtros (vía page reset) o la página
useEffect(() => { load() }, [debouncedSearch, filterTipo, filterCategoria, filterEstado, onlyMissingImage, page])
```
(Es aceptable la doble corrida inicial; si preferís, se puede unificar, pero mantenelo simple y correcto: cambiar un filtro setea page=1 y dispara load.)

- [ ] **Step 4: Eliminar el filtrado client-side**

Borrar el bloque `const filtered = items.filter(...)` (client-side). Sustituir TODOS los usos de `filtered` por `items` en el resto del componente (lista grid/list, `dnd = useDragReorder(filtered, ...)` → `useDragReorder(items, ...)`, `selectAllVisible` sobre `filtered` → `items`, `allVisibleSelected` sobre `filtered` → `items`, los `filtered.length` → `items.length` donde refieran a lo visible, y el render `filtered.map(...)` → `items.map(...)`).
Borrar también `const sinImagenCount = items.filter(...)` (ahora viene del meta) y `const tagSuggestions = Array.from(...)` (ahora es estado del meta). `hasFilters` se mantiene (deriva de los filtros, no de la lista).

- [ ] **Step 5: Regla de reorder con paginación**

Actualizar `canReorder` para exigir una sola página:
```tsx
const canReorder = !hasFilters && selected.size === 0 && viewMode === "grid" && totalPages === 1
```
En `handleReorder`, tras el PATCH exitoso, recargar la página actual (`load()`), no recomputar en memoria. Si ya llamaba `load()` en el catch, dejarlo.

- [ ] **Step 6: Refrescar tras mutaciones**

En los handlers que hoy llaman `load()` tras crear/editar/borrar/duplicar/bulk (incl. el `onSaved` del dialog y `runBulk`), agregar también `loadMeta()` para refrescar tags y contador. Para inline edit (`saveField`) NO hace falta recargar (update optimista), pero si cambia imagen no aplica acá. Mantener el resto del comportamiento.

- [ ] **Step 7: Controles de paginación**

Debajo de la lista (después del bloque grid/list y antes del bulk bar flotante), agregar:
```tsx
{!loading && total > 0 && (
  <div className="flex items-center justify-between pt-2 text-sm">
    <span className="text-muted-foreground">
      {total} item{total === 1 ? "" : "s"} · página {page} de {totalPages}
    </span>
    <div className="flex items-center gap-1">
      <Button variant="outline" size="sm" className="gap-1"
        disabled={page <= 1}
        onClick={() => setPage((p) => Math.max(1, p - 1))}>
        <ChevronLeft className="h-4 w-4" /> Anterior
      </Button>
      <Button variant="outline" size="sm" className="gap-1"
        disabled={page >= totalPages}
        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
        Siguiente <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  </div>
)}
```

- [ ] **Step 8: `tagSuggestions` al dialog**

El `<CatalogoItemDialog ... tagSuggestions={tagSuggestions} />` ya recibía la prop; ahora `tagSuggestions` es estado del meta (mismo nombre) → no cambia el JSX.

- [ ] **Step 9: Empty state**

El `EmptyState` "Sin resultados" usa `items.length === 0`. Con server-side, cuando hay búsqueda/filtros y 0 resultados, mostrar "Sin resultados / Probá ajustar los filtros"; cuando NO hay filtros y total 0, "Sin items todavía / Creá tu primer producto". Usar `hasFilters` para distinguir (en vez de `items.length` vs total). Ajustar la condición del EmptyState a: título/deschange según `hasFilters`.

- [ ] **Step 10: Verify**
- `npx tsc --noEmit` → 0 errores.
- `npx eslint "components/catalogo/catalogo-items-tab.tsx"` → 0 warnings (limpiar imports/vars sin uso).

- [ ] **Step 11: Commit**
```bash
git add components/catalogo/catalogo-items-tab.tsx
git commit -m "feat(catalogo): items-tab server-driven (búsqueda+paginación, meta, reorder 1-página)"
```

---

## Verificación final

- [ ] `npx vitest run __tests__/lib/catalogo-items-query.test.ts __tests__/components/use-debounced-value.test.tsx __tests__/api/catalogo-items-search.test.ts __tests__/api/catalogo-items-meta.test.ts` → todo PASS.
- [ ] `npx vitest run __tests__/api/` → sin regresiones en otros tests de API.
- [ ] `npx tsc --noEmit` → 0 errores.
- [ ] `npx eslint "components/catalogo/**" "app/api/catalogo/**" "lib/catalogo/**"` → 0 warnings nuevos.
- [ ] `npm run build` → exit 0.
- [ ] Manual: lista pagina (Anterior/Siguiente, "página X de Y"); buscar por nombre, por SKU de variante, por código de inventario; cambiar filtros resetea a page 1 y debouncea; tags-suggestions y banner "sin foto" siguen; reorder solo con 1 página y sin filtros.

## Criterios de aceptación (del spec)

1. ✅ Búsqueda por nombre + SKU variante + código inventario (Task 3).
2. ✅ Paginación server-side con total/página (Tasks 3, 5).
3. ✅ Reset a page 1 + debounce al cambiar búsqueda/filtros (Tasks 2, 5).
4. ✅ Tags + contador sin-foto vía /meta (Tasks 4, 5).
5. ✅ Reorder solo en 1 página sin filtros (Task 5).
6. ✅ tsc/eslint/build verdes; tests nuevos pasan.
