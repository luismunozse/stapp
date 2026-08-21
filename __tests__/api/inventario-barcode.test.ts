import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"
import {
  mockAuthSuccess, mockAuthError, createGetRequest, parseResponse,
} from "./helpers"
import { resetCacheResolucionVenta } from "@/lib/sucursal"
import { GET } from "@/app/api/inventario/barcode/route"

function mockNoCookie() {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn(() => undefined),
    set: vi.fn(),
  } as any)
}

// A minimal inventario row for barcode queries
const ITEM_ROW = {
  id: "i1",
  codigo: "ABC123",
  nombre: "Producto Test",
  stock: 10,
  stock_reservado: 1,
  precio_venta: 500,
  precio_compra: 200,
  barcode: "7890001234567",
  trackea_series: false,
  proveedor_id: null,
  organization_id: "org-1",
  deleted_at: null,
  proveedores: null,
}

/**
 * Create a chain that supports the barcode route's query methods:
 * select().eq().ilike().is().order().limit() → resolves with data
 */
function makeInventarioChain(rows: any[]) {
  const chain: any = {}
  const methods = ["select", "eq", "ilike", "is", "order", "limit"]
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)
  chain.then = (resolve: any) => Promise.resolve({ data: rows, error: null }).then(resolve)
  chain.catch = (reject: any) => Promise.resolve({ data: rows, error: null }).catch(reject)
  return chain
}

function makeDepositosChain(depositoId: string | null) {
  const chain: any = {}
  for (const m of ["select", "eq", "is"]) chain[m] = vi.fn().mockReturnValue(chain)
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: depositoId ? { id: depositoId } : null, error: null })
  return chain
}

function makeDepStockChain(stock: number | null) {
  const chain: any = {}
  for (const m of ["select", "eq"]) chain[m] = vi.fn().mockReturnValue(chain)
  chain.maybeSingle = vi.fn().mockResolvedValue({
    data: stock !== null ? { stock, stock_reservado: 0 } : null,
    error: null,
  })
  return chain
}

describe("GET /api/inventario/barcode", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Module-level cache: vi.clearAllMocks() does not touch it, so a resolution
    // from a previous test would otherwise leak into the next one.
    resetCacheResolucionVenta()
    mockNoCookie()
  })

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/barcode?code=ABC"))
    const { status } = await parseResponse(res)
    expect(status).toBe(401)
  })

  it("returns 400 when no code provided", async () => {
    mockAuthSuccess()
    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/barcode"))
    const { status } = await parseResponse(res)
    expect(status).toBe(400)
  })

  it("ADMIN verTodas: returns aggregate stock from inventario row", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const invChain = makeInventarioChain([ITEM_ROW])
    vi.mocked(supabaseAdmin.from).mockReturnValue(invChain as any)

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/barcode?code=7890001234567"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.found).toBe(true)
    // Aggregate stock — from the row directly
    expect(body.item.stock).toBe(10)
  })

  it("VENDEDOR con sucursalId: returns stock from sucursal deposito", async () => {
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

    const invChain = makeInventarioChain([ITEM_ROW])
    const depositosChain = makeDepositosChain("dep-1")
    const depStockChain = makeDepStockChain(2)

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "depositos") return depositosChain as any
      if (table === "inventario_depositos") return depStockChain as any
      if (table === "inventario") return invChain as any
      return { then: (r: any) => r({ data: null, error: { message: `No mock for: ${table}` } }) } as any
    })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/barcode?code=7890001234567"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.found).toBe(true)
    // Stock from deposito row (2), not aggregate (10)
    expect(body.item.stock).toBe(2)
  })

  it("VENDEDOR: item sin stock en sucursal deposito returns stock=0", async () => {
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

    const invChain = makeInventarioChain([ITEM_ROW])
    const depositosChain = makeDepositosChain("dep-1")
    const depStockChain = makeDepStockChain(null) // no row in inventario_depositos

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "depositos") return depositosChain as any
      if (table === "inventario_depositos") return depStockChain as any
      if (table === "inventario") return invChain as any
      return { then: (r: any) => r({ data: null, error: { message: `No mock for: ${table}` } }) } as any
    })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/barcode?code=7890001234567"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.found).toBe(true)
    expect(body.item.stock).toBe(0)
  })

  it("ADMIN verTodas con scope=venta: usa el depósito de la sucursal principal, no el stock agregado", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockNoCookie() // selector en "todas"

    const invChain = makeInventarioChain([ITEM_ROW]) // ITEM_ROW.stock === 10 (aggregate)
    const sucursalesChain: any = {}
    for (const m of ["select", "eq", "is"]) sucursalesChain[m] = vi.fn().mockReturnValue(sucursalesChain)
    sucursalesChain.single = vi.fn().mockResolvedValue({ data: { id: "suc-principal" }, error: null })
    const depositosChain = makeDepositosChain("dep-principal")
    const depStockChain = makeDepStockChain(3)

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "sucursales") return sucursalesChain as any
      if (table === "depositos") return depositosChain as any
      if (table === "inventario_depositos") return depStockChain as any
      if (table === "inventario") return invChain as any
      return { then: (r: any) => r({ data: null, error: { message: `No mock for: ${table}` } }) } as any
    })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/barcode?code=7890001234567&scope=venta"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.found).toBe(true)
    // Scoped stock (3), NOT the aggregate value (10) that "todas" would otherwise return
    expect(body.item.stock).toBe(3)
  })

  it("scope=venta en modo drenaje (sucursal sin depósito principal): devuelve el stock agregado, no 0", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockNoCookie()

    const invChain = makeInventarioChain([ITEM_ROW]) // ITEM_ROW.stock === 10 (aggregate)
    const sucursalesChain: any = {}
    for (const m of ["select", "eq", "is"]) sucursalesChain[m] = vi.fn().mockReturnValue(sucursalesChain)
    sucursalesChain.single = vi.fn().mockResolvedValue({ data: { id: "suc-principal" }, error: null })
    const depositosChain = makeDepositosChain(null)

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "sucursales") return sucursalesChain as any
      if (table === "depositos") return depositosChain as any
      if (table === "inventario") return invChain as any
      return { then: (r: any) => r({ data: null, error: { message: `No mock for: ${table}` } }) } as any
    })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/barcode?code=7890001234567&scope=venta"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.found).toBe(true)
    // The write path drains org-wide when there is no deposito, so refusing
    // the scan with stock 0 would block a sale the RPC would have accepted.
    expect(body.item.stock).toBe(10)
  })

  it("scope=venta con VENDEDOR sin sucursal asignada: sigue fail-closed (stock 0)", async () => {
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

    const invChain = makeInventarioChain([ITEM_ROW]) // ITEM_ROW.stock === 10 (aggregate)
    const sucursalesChain: any = {}
    for (const m of ["select", "eq", "is"]) sucursalesChain[m] = vi.fn().mockReturnValue(sucursalesChain)
    sucursalesChain.single = vi.fn().mockResolvedValue({ data: { id: "suc-principal" }, error: null })
    const depositosChain = makeDepositosChain("dep-principal")
    const depStockChain = makeDepStockChain(3)

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "sucursales") return sucursalesChain as any
      if (table === "depositos") return depositosChain as any
      if (table === "inventario_depositos") return depStockChain as any
      if (table === "inventario") return invChain as any
      return { then: (r: any) => r({ data: null, error: { message: `No mock for: ${table}` } }) } as any
    })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/barcode?code=7890001234567&scope=venta"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.found).toBe(true)
    // Neither the aggregate (10) nor the principal sucursal's deposito (3).
    expect(body.item.stock).toBe(0)
  })

  it.each(["VENDEDOR", "TECNICO"])(
    "scope=venta con %s cuya sucursal no tiene depósito principal: fail-closed (stock 0), NO el agregado",
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

      const invChain = makeInventarioChain([ITEM_ROW]) // ITEM_ROW.stock === 10 (aggregate)
      const sucursalesChain: any = {}
      for (const m of ["select", "eq", "is"]) sucursalesChain[m] = vi.fn().mockReturnValue(sucursalesChain)
      sucursalesChain.single = vi.fn().mockResolvedValue({ data: { id: "suc-principal" }, error: null })
      const depositosChain = makeDepositosChain(null) // suc-B misconfigured

      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table === "sucursales") return sucursalesChain as any
        if (table === "depositos") return depositosChain as any
        if (table === "inventario") return invChain as any
        return { then: (r: any) => r({ data: null, error: { message: `No mock for: ${table}` } }) } as any
      })

      const res = await GET(createGetRequest("http://localhost:3000/api/inventario/barcode?code=7890001234567&scope=venta"))
      const { status, body } = await parseResponse(res)

      expect(status).toBe(200)
      expect(body.found).toBe(true)
      // Drain mode widens the read only for an org-wide role. A branch-scoped
      // one would otherwise be told it can sell another branch's units.
      expect(body.item.stock).toBe(0)
    }
  )
})
