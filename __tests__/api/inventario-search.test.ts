import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"
import {
  mockAuthSuccess, mockAuthError, createChainMock, mockSupabaseFrom,
  createGetRequest, parseResponse,
} from "./helpers"
import { resetCacheResolucionVenta } from "@/lib/sucursal"
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
    // Module-level cache: vi.clearAllMocks() does not touch it, so a resolution
    // from a previous test would otherwise leak into the next one.
    resetCacheResolucionVenta()
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
  beforeEach(() => {
    vi.clearAllMocks()
    resetCacheResolucionVenta()
  })

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
  beforeEach(() => {
    vi.clearAllMocks()
    resetCacheResolucionVenta()
  })

  // The `sucursales` table is read two different ways on this path:
  //  - getPrincipalId  → .single(), the org's principal sucursal
  //  - resolverIndicadorVenta → awaits the chain, the full list (name + count)
  // One mock has to serve both.
  function makeSucursalesChain(
    sucursalId: string | null,
    nombre?: string,
    lista?: Array<{ id: string; nombre: string }>
  ) {
    const chain: any = {}
    for (const m of ["select", "eq", "is"]) chain[m] = vi.fn().mockReturnValue(chain)
    chain.single = vi.fn().mockResolvedValue({
      data: sucursalId ? { id: sucursalId, nombre: nombre ?? "Sucursal Test" } : null,
      error: null,
    })
    const rows =
      lista ??
      (sucursalId
        ? [
            { id: sucursalId, nombre: nombre ?? "Sucursal Test" },
            { id: "suc-otra", nombre: "Sucursal Norte" },
          ]
        : [])
    chain.then = (resolve: any, reject?: any) =>
      Promise.resolve({ data: rows, error: null }).then(resolve, reject)
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

  it("tecleo seguido: la resolucion de sucursal/deposito se paga una sola vez, no por tecla", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockNoCookie()

    const sucursalesChain = makeSucursalesChain("suc-principal", "Casa Central")
    const depositosChain = makeDepositosChain("dep-principal")
    const invChain = createChainMock([])
    mockFromPerTable({ sucursales: sucursalesChain, depositos: depositosChain, inventario: invChain })

    // Three debounced keystrokes of the same POS session.
    for (const q of ["no", "not", "note"]) {
      const res = await GET(
        createGetRequest(`http://localhost:3000/api/inventario/search?q=${q}&limit=20&scope=venta`)
      )
      expect(res.status).toBe(200)
      // Scoping must stay correct on every one of them.
      expect(res.headers.get("X-Venta-Sucursal-Id")).toBe("suc-principal")
    }

    const reads = (tabla: string) =>
      vi.mocked(supabaseAdmin.from).mock.calls.filter((call) => call[0] === tabla).length
    expect(reads("sucursales")).toBe(1)
    expect(reads("depositos")).toBe(1)
    // The catalog query itself is NOT cached — every keystroke still searches.
    expect(reads("inventario")).toBe(3)
  })

  it("dos montajes de PosProductSearch (desktop + mobile): el nombre del indicador se resuelve una vez", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockNoCookie()

    const sucursalesChain = makeSucursalesChain("suc-principal", "Casa Central")
    const depositosChain = makeDepositosChain("dep-principal")
    const invChain = createChainMock([])
    mockFromPerTable({ sucursales: sucursalesChain, depositos: depositosChain, inventario: invChain })

    const url = "http://localhost:3000/api/inventario/search?q=&limit=20&scope=venta&ventaInfo=true"
    const primera = await GET(createGetRequest(url))
    const segunda = await GET(createGetRequest(url))

    // Both mounts still get the indicator...
    for (const res of [primera, segunda]) {
      expect(decodeURIComponent(res.headers.get("X-Venta-Sucursal-Nombre")!)).toBe("Casa Central")
    }
    // ...but `sucursales` is read once for getPrincipalId and once for the
    // indicator list, and neither is repeated for the second mount.
    const sucursalesReads = vi
      .mocked(supabaseAdmin.from)
      .mock.calls.filter((call) => call[0] === "sucursales").length
    expect(sucursalesReads).toBe(2)
  })

  it("org de UNA sola sucursal: NO manda nombre para el indicador (el switcher ni existe para ella)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockNoCookie() // never set: SucursalSwitcher renders null for these orgs

    const sucursalesChain = makeSucursalesChain("suc-unica", "Casa Central", [
      { id: "suc-unica", nombre: "Casa Central" },
    ])
    const depositosChain = makeDepositosChain("dep-unico")
    const invChain = createChainMock([
      {
        id: "i1", codigo: "C1", nombre: "Notebook",
        precio_venta: 100, precio_compra: 60, trackea_series: false,
        inventario_depositos: [{ stock: 4, stock_reservado: 0, deposito_id: "dep-unico" }],
      },
    ])
    mockFromPerTable({ sucursales: sucursalesChain, depositos: depositosChain, inventario: invChain })

    const res = await GET(
      createGetRequest("http://localhost:3000/api/inventario/search?q=note&scope=venta&ventaInfo=true")
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    // The scoping still happens (that is the point of scope=venta)...
    expect(res.headers.get("X-Venta-Sucursal-Id")).toBe("suc-unica")
    // ...but there is nothing to disambiguate, so no indicator.
    expect(res.headers.get("X-Venta-Sucursal-Nombre")).toBe("")
  })

  it("ADMIN con una sucursal concreta seleccionada: NO manda nombre (el selector ya la muestra)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const sucursalesChain = makeSucursalesChain("suc-principal", "Casa Central")
    const depositosChain = makeDepositosChain("dep-A")
    const invChain = createChainMock([])
    mockFromPerTable({ sucursales: sucursalesChain, depositos: depositosChain, inventario: invChain })

    const res = await GET(
      createGetRequest("http://localhost:3000/api/inventario/search?q=note&scope=venta&ventaInfo=true")
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(res.headers.get("X-Venta-Sucursal-Id")).toBe("suc-A")
    expect(res.headers.get("X-Venta-Sucursal-Nombre")).toBe("")
  })

  it("ADMIN con sucursal concreta SIN depósito principal: avisa que la lectura es de toda la org", async () => {
    // El único estado donde la pantalla se contradice sola: el chip del
    // switcher dice "Sucursal A" mientras la grilla lista stock que está en
    // otras sucursales, y el indicador "Vendiendo desde" está apagado (el RPC
    // puede drenar de cualquier depósito, nombrar una sucursal sería mentira).
    // Los números son honestos sobre lo que la venta puede tomar; falta que la
    // UI lo diga, y este header es la única señal que el browser puede leer.
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const sucursalesChain = makeSucursalesChain("suc-principal", "Casa Central")
    const depositosChain = makeDepositosChain(null) // suc-A sin depósito principal
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
    expect(body[0].stock).toBe(7) // agregado org-wide, como el write path
    expect(res.headers.get("X-Venta-Sucursal-Nombre")).toBe("")
    expect(res.headers.get("X-Venta-Alcance")).toBe("org")
  })

  it("ADMIN con sucursal concreta Y depósito propio: no avisa alcance org", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const sucursalesChain = makeSucursalesChain("suc-principal", "Casa Central")
    const depositosChain = makeDepositosChain("dep-A")
    const invChain = createChainMock([])
    mockFromPerTable({ sucursales: sucursalesChain, depositos: depositosChain, inventario: invChain })

    const res = await GET(
      createGetRequest("http://localhost:3000/api/inventario/search?q=note&scope=venta&ventaInfo=true")
    )

    expect(res.headers.get("X-Venta-Alcance")).toBe("")
  })

  it("ADMIN en 'todas' en modo drenaje: no avisa (el chip ya dice toda la org)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockNoCookie()

    const sucursalesChain = makeSucursalesChain("suc-principal", "Casa Central")
    const depositosChain = makeDepositosChain(null)
    const invChain = createChainMock([])
    mockFromPerTable({ sucursales: sucursalesChain, depositos: depositosChain, inventario: invChain })

    const res = await GET(
      createGetRequest("http://localhost:3000/api/inventario/search?q=note&scope=venta&ventaInfo=true")
    )

    expect(res.headers.get("X-Venta-Alcance")).toBe("")
  })

  it("VENDEDOR con sucursal asignada: NO manda nombre (nunca ve mas de una sucursal)", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "vendedor-1",
        organizationId: "org-1",
        role: "VENDEDOR",
        sucursalId: "suc-V",
        email: "v@v.com",
      },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as any)
    mockNoCookie()

    const sucursalesChain = makeSucursalesChain("suc-principal", "Casa Central")
    const depositosChain = makeDepositosChain("dep-V")
    const invChain = createChainMock([])
    mockFromPerTable({ sucursales: sucursalesChain, depositos: depositosChain, inventario: invChain })

    const res = await GET(
      createGetRequest("http://localhost:3000/api/inventario/search?q=note&scope=venta&ventaInfo=true")
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(res.headers.get("X-Venta-Sucursal-Id")).toBe("suc-V")
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

  it.each(["VENDEDOR", "TECNICO"])(
    "scope=venta con %s cuya sucursal no tiene depósito principal: fail-closed, NO el agregado de la org",
    async (role) => {
      vi.mocked(auth).mockResolvedValue({
        user: {
          id: "usuario-suc-B",
          organizationId: "org-1",
          role,
          sucursalId: "suc-B",
          email: "u@u.com",
        },
        expires: new Date(Date.now() + 86400000).toISOString(),
      } as any)
      mockNoCookie()

      const sucursalesChain = makeSucursalesChain("suc-principal", "Casa Central")
      const depositosChain = makeDepositosChain(null) // suc-B misconfigured
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
      // The org-wide aggregate counts units sitting in OTHER branches, and it
      // leaks precio_compra too. A misconfigured branch must read as "nothing
      // here", never as another branch's inventory.
      expect(body).toEqual([])
      expect(invChain.select).not.toHaveBeenCalled()
      expect(res.headers.get("X-Venta-Sucursal-Id")).toBe("")
      expect(res.headers.get("X-Venta-Sucursal-Nombre")).toBe("")
    }
  )

  it("scope=venta con VENDEDOR bien configurado y org sin sucursal principal: sigue escopeado a SU depósito", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "vendedor-1",
        organizationId: "org-1",
        role: "VENDEDOR",
        sucursalId: "suc-B",
        email: "v@v.com",
      },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as any)
    mockNoCookie()

    // getPrincipalId comes back empty (none configured, two principal rows, or
    // a transient failure) — an org-level lookup this user never needed.
    const sucursalesChain = makeSucursalesChain(null)
    const depositosChain = makeDepositosChain("dep-B")
    const invChain = createChainMock([
      {
        id: "i1", codigo: "C1", nombre: "Notebook",
        precio_venta: 100, precio_compra: 60, trackea_series: false,
        inventario_depositos: [{ stock: 2, stock_reservado: 0, deposito_id: "dep-B" }],
      },
    ])
    mockFromPerTable({ sucursales: sucursalesChain, depositos: depositosChain, inventario: invChain })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/search?q=note&scope=venta"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body[0].stock).toBe(2)
    expect(invChain.eq).toHaveBeenCalledWith("inventario_depositos.deposito_id", "dep-B")
    expect(res.headers.get("X-Venta-Sucursal-Id")).toBe("suc-B")
  })
})
