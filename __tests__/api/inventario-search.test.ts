import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"
import {
  mockAuthSuccess, mockAuthError, createChainMock, mockSupabaseFrom,
  createGetRequest, parseResponse,
} from "./helpers"
import { GET } from "@/app/api/inventario/search/route"

// Helper: configure the cookies mock for sucursal tests
function mockCookie(value: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) =>
      name === "stapp-sucursal-activa" && value ? { value } : undefined
    ),
    set: vi.fn(),
  } as any)
}

function mockNoCookie() {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn(() => undefined),
    set: vi.fn(),
  } as any)
}

// Build a per-table supabase.from mock
function mockFromPerTable(tableChains: Record<string, any>) {
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    return (tableChains[table] || createChainMock(null, { message: `No mock for table: ${table}` })) as any
  })
}

// Build a simple depositos chain that resolves with maybeSingle
function makeDepositosChain(depositoId: string | null) {
  const chain: any = {}
  const methods = ["select", "eq", "is"]
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)
  chain.maybeSingle = vi.fn().mockResolvedValue({
    data: depositoId ? { id: depositoId } : null,
    error: null,
  })
  return chain
}

describe("GET /api/inventario/search", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNoCookie()
  })

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/search?q=note"))
    const { status } = await parseResponse(res)
    expect(status).toBe(401)
  })

  it("incluye trackeaSeries en el payload (ADMIN verTodas)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const invChain = createChainMock([
      { id: "i1", codigo: "C1", nombre: "Notebook", stock: 5, stock_reservado: 0,
        precio_venta: 100, precio_compra: 60, trackea_series: true },
    ])
    mockSupabaseFrom({ inventario: invChain })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/search?q=note"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body[0].trackeaSeries).toBe(true)
  })

  it("usa ILIKE substring sobre nombre Y codigo (no full-text) para queries >= 3 chars", async () => {
    mockAuthSuccess()
    const invChain = createChainMock([])
    mockSupabaseFrom({ inventario: invChain })

    await GET(createGetRequest("http://localhost:3000/api/inventario/search?q=tornil"))

    // Substring match on both name and code — finds "tornillo" from "tornil"
    expect(invChain.or).toHaveBeenCalledTimes(1)
    const filter = invChain.or.mock.calls[0][0] as string
    expect(filter).toContain("nombre.ilike.%tornil%")
    expect(filter).toContain("codigo.ilike.%tornil%")
    // Full-text search must NOT be used (it misses partial words / codes)
    expect(invChain.textSearch).not.toHaveBeenCalled()
  })

  it("encuentra por codigo parcial alfanumerico (caso que el full-text rompia)", async () => {
    mockAuthSuccess()
    const invChain = createChainMock([])
    mockSupabaseFrom({ inventario: invChain })

    await GET(createGetRequest("http://localhost:3000/api/inventario/search?q=ABC1"))

    const filter = invChain.or.mock.calls[0][0] as string
    expect(filter).toContain("codigo.ilike.%ABC1%")
    expect(invChain.textSearch).not.toHaveBeenCalled()
  })

  it("multi-palabra: cada termino debe matchear (AND de ORs sobre nombre/codigo)", async () => {
    mockAuthSuccess()
    const invChain = createChainMock([])
    mockSupabaseFrom({ inventario: invChain })

    await GET(createGetRequest("http://localhost:3000/api/inventario/search?q=cable%20usb"))

    // One .or() per term, AND-combined
    expect(invChain.or).toHaveBeenCalledTimes(2)
    expect(invChain.or.mock.calls[0][0]).toContain("nombre.ilike.%cable%")
    expect(invChain.or.mock.calls[1][0]).toContain("nombre.ilike.%usb%")
  })

  it("sanitiza caracteres que romperian el filtro PostgREST", async () => {
    mockAuthSuccess()
    const invChain = createChainMock([])
    mockSupabaseFrom({ inventario: invChain })

    await GET(createGetRequest(`http://localhost:3000/api/inventario/search?q=${encodeURIComponent("a,b)(%_*")}`))

    // The dangerous chars (, ) ( % _ *) must not reach the filter string raw
    const calls = invChain.or.mock.calls.map((c: any[]) => c[0]).join("|")
    expect(calls).not.toContain(",b")
    expect(calls).not.toContain(")")
    expect(calls).not.toContain("(")
    expect(calls).not.toContain("*")
  })
})

describe("GET /api/inventario/search — scoped por sucursal", () => {
  beforeEach(() => vi.clearAllMocks())

  it("VENDEDOR con sucursalId fija: query usa inventario_depositos!inner filtrado por deposito_id de la sucursal", async () => {
    // VENDEDOR con sucursalId = "suc-1" en sesion
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "vendedor-1",
        organizationId: "org-1",
        role: "VENDEDOR",
        sucursalId: "suc-1",
        email: "v@v.com",
      },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as any)
    mockNoCookie()

    const depositosChain = makeDepositosChain("dep-1")
    const invChain = createChainMock([
      {
        id: "i1", codigo: "C1", nombre: "Notebook",
        precio_venta: 100, precio_compra: 60, trackea_series: false,
        inventario_depositos: [{ stock: 3, stock_reservado: 0, deposito_id: "dep-1" }],
      },
    ])

    mockFromPerTable({ depositos: depositosChain, inventario: invChain })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/search?q=note"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    // Returns stock from the deposito row (3), not aggregate
    expect(body[0].stock).toBe(3)
    // The inventario query must filter by deposito_id
    expect(invChain.eq).toHaveBeenCalledWith("inventario_depositos.deposito_id", "dep-1")
    // Must filter stock > 0 in inventario_depositos
    expect(invChain.gt).toHaveBeenCalledWith("inventario_depositos.stock", 0)
  })

  it("ADMIN verTodas (sin cookie): query agrega stock desde inventario.stock", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockNoCookie()

    const invChain = createChainMock([
      { id: "i2", codigo: "C2", nombre: "Cable", stock: 10, stock_reservado: 0,
        precio_venta: 50, precio_compra: 20, trackea_series: false },
    ])
    mockSupabaseFrom({ inventario: invChain })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/search?q=cable"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body[0].stock).toBe(10)
    // Aggregate path: filters on inventario.stock > 0, NOT inventario_depositos
    expect(invChain.gt).toHaveBeenCalledWith("stock", 0)
    expect(invChain.gt).not.toHaveBeenCalledWith("inventario_depositos.stock", 0)
  })

  it("sucursal sin deposito principal: devuelve lista vacia", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "vendedor-1",
        organizationId: "org-1",
        role: "VENDEDOR",
        sucursalId: "suc-sin-dep",
        email: "v@v.com",
      },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as any)
    mockNoCookie()

    const depositosChain = makeDepositosChain(null)
    mockFromPerTable({ depositos: depositosChain })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/search?q=test"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body).toEqual([])
  })

  it("ADMIN con cookie de sucursal: usa deposito de esa sucursal (scoped)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const depositosChain = makeDepositosChain("dep-A")
    const invChain = createChainMock([
      {
        id: "i3", codigo: "C3", nombre: "Funda",
        precio_venta: 200, precio_compra: 80, trackea_series: false,
        inventario_depositos: [{ stock: 5, stock_reservado: 1, deposito_id: "dep-A" }],
      },
    ])

    mockFromPerTable({ depositos: depositosChain, inventario: invChain })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/search?q=funda"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body[0].stock).toBe(5)
    expect(body[0].stockReservado).toBe(1)
    expect(invChain.eq).toHaveBeenCalledWith("inventario_depositos.deposito_id", "dep-A")
  })
})

describe("GET /api/inventario/search — scope=venta (POS opt-in)", () => {
  beforeEach(() => vi.clearAllMocks())

  function makeSucursalesChain(sucursalId: string | null, nombre?: string) {
    const chain: any = {}
    for (const m of ["select", "eq", "is"]) chain[m] = vi.fn().mockReturnValue(chain)
    chain.single = vi.fn().mockResolvedValue({
      data: sucursalId ? { id: sucursalId, nombre: nombre ?? "Sucursal Test" } : null,
      error: null,
    })
    return chain
  }

  it("ADMIN en 'todas' con scope=venta: ignora el selector y escopea al depósito de la sucursal principal", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockNoCookie() // selector en "todas"

    const sucursalesChain = makeSucursalesChain("suc-principal", "Casa Central")
    const depositosChain = makeDepositosChain("dep-principal")
    const invChain = createChainMock([
      {
        id: "i1", codigo: "C1", nombre: "Notebook",
        precio_venta: 100, precio_compra: 60, trackea_series: false,
        inventario_depositos: [{ stock: 4, stock_reservado: 0, deposito_id: "dep-principal" }],
      },
    ])

    mockFromPerTable({ sucursales: sucursalesChain, depositos: depositosChain, inventario: invChain })

    const res = await GET(
      createGetRequest("http://localhost:3000/api/inventario/search?q=note&scope=venta&ventaInfo=true")
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    // Scoped stock (4), NOT the aggregate value that "todas" would otherwise return
    expect(body[0].stock).toBe(4)
    expect(invChain.eq).toHaveBeenCalledWith("inventario_depositos.deposito_id", "dep-principal")
    expect(res.headers.get("X-Venta-Sucursal-Id")).toBe("suc-principal")
    expect(decodeURIComponent(res.headers.get("X-Venta-Sucursal-Nombre")!)).toBe("Casa Central")
  })

  it("scope=venta sin ventaInfo: no resuelve el nombre (evita una query por tecla)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockNoCookie()

    const sucursalesChain = makeSucursalesChain("suc-principal", "Casa Central")
    const depositosChain = makeDepositosChain("dep-principal")
    const invChain = createChainMock([])
    mockFromPerTable({ sucursales: sucursalesChain, depositos: depositosChain, inventario: invChain })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/search?q=note&scope=venta"))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    // The id is free (already resolved), only the name costs a query.
    expect(res.headers.get("X-Venta-Sucursal-Id")).toBe("suc-principal")
    expect(res.headers.get("X-Venta-Sucursal-Nombre")).toBe("")
    // Only getPrincipalId reads `sucursales`; getNombreSucursal must not run.
    const sucursalesReads = vi
      .mocked(supabaseAdmin.from)
      .mock.calls.filter((call) => call[0] === "sucursales")
    expect(sucursalesReads).toHaveLength(1)
  })

  it("sin scope=venta, ADMIN en 'todas' sigue devolviendo stock agregado (comportamiento no tocado)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockNoCookie()

    const invChain = createChainMock([
      { id: "i2", codigo: "C2", nombre: "Cable", stock: 10, stock_reservado: 0,
        precio_venta: 50, precio_compra: 20, trackea_series: false },
    ])
    mockSupabaseFrom({ inventario: invChain })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/search?q=cable"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body[0].stock).toBe(10)
    expect(res.headers.get("X-Venta-Sucursal-Id")).toBeNull()
  })

  it("scope=venta en modo drenaje (sucursal sin depósito principal): cae al stock agregado, no a catálogo vacío", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockNoCookie()

    const sucursalesChain = makeSucursalesChain("suc-principal", "Casa Central")
    const depositosChain = makeDepositosChain(null)
    const invChain = createChainMock([
      { id: "i9", codigo: "C9", nombre: "Teclado", stock: 7, stock_reservado: 0,
        precio_venta: 30, precio_compra: 10, trackea_series: false },
    ])
    mockFromPerTable({ sucursales: sucursalesChain, depositos: depositosChain, inventario: invChain })

    const res = await GET(
      createGetRequest("http://localhost:3000/api/inventario/search?q=teclado&scope=venta&ventaInfo=true")
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    // The write path passes p_deposito_id = null and drains org-wide in this
    // state, so the sale WOULD succeed — the read must not hide the catalog.
    expect(body).toHaveLength(1)
    expect(body[0].stock).toBe(7)
    expect(invChain.gt).toHaveBeenCalledWith("stock", 0)
    // ...but the stock can come from ANY sucursal's deposito, so the indicator
    // must not claim one (see derivarLecturaVenta).
    expect(res.headers.get("X-Venta-Sucursal-Id")).toBe("")
    expect(res.headers.get("X-Venta-Sucursal-Nombre")).toBe("")
  })

  it("scope=venta con VENDEDOR sin sucursal asignada: sigue fail-closed (catalogo vacio, sin indicador)", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "vendedor-sin-sucursal",
        organizationId: "org-1",
        role: "VENDEDOR",
        sucursalId: null,
        email: "v@v.com",
      },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as any)
    mockNoCookie()

    const sucursalesChain = makeSucursalesChain("suc-principal", "Casa Central")
    const depositosChain = makeDepositosChain("dep-principal")
    const invChain = createChainMock([
      { id: "i1", codigo: "C1", nombre: "Notebook", stock: 5, stock_reservado: 0,
        precio_venta: 100, precio_compra: 60, trackea_series: false },
    ])
    mockFromPerTable({ sucursales: sucursalesChain, depositos: depositosChain, inventario: invChain })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/search?q=note&scope=venta"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    // The write path falls back to the principal sucursal, but a non-ADMIN with
    // no assigned sucursal must keep seeing nothing (SUCURSAL_NINGUNA behavior).
    expect(body).toEqual([])
    expect(invChain.select).not.toHaveBeenCalled()
    expect(res.headers.get("X-Venta-Sucursal-Id")).toBe("")
  })
})
