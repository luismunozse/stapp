import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"
import {
  mockAuthSuccess,
  createChainMock,
  createGetRequest,
  parseResponse,
} from "./helpers"
import { GET } from "@/app/api/inventario/search/route"

function mockNoCookie() {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn(() => undefined),
    set: vi.fn(),
  } as any)
}

// Build a per-table supabase.from mock (mirrors inventario-search.test.ts)
function mockFromPerTable(tableChains: Record<string, any>) {
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    return (tableChains[table] || createChainMock(null, { message: `No mock for table: ${table}` })) as any
  })
}

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

function mockVendedor(sucursalId = "suc-1") {
  vi.mocked(auth).mockResolvedValue({
    user: {
      id: "vendedor-1",
      organizationId: "org-1",
      role: "VENDEDOR",
      sucursalId,
      email: "v@v.com",
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

function mockTecnico(sucursalId = "suc-1") {
  vi.mocked(auth).mockResolvedValue({
    user: {
      id: "tecnico-1",
      organizationId: "org-1",
      role: "TECNICO",
      sucursalId,
      email: "t@t.com",
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

// organizations chain used by resolveVendedoresHabilitados()
function orgChain(vendedoresAdministranInventario: boolean) {
  return createChainMock({ vendedores_administran_inventario: vendedoresAdministranInventario })
}

describe("GET /api/inventario/search — cost visibility gated by hasInventarioAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNoCookie()
  })

  it("strips precioCompra (null) for TECNICO — never gets inventario cost access", async () => {
    mockTecnico()

    const depositosChain = makeDepositosChain("dep-1")
    const invChain = createChainMock([
      {
        id: "i1",
        codigo: "C1",
        nombre: "Notebook",
        precio_venta: 100,
        precio_compra: 60,
        trackea_series: false,
        inventario_depositos: [{ stock: 3, stock_reservado: 0, deposito_id: "dep-1" }],
      },
    ])
    mockFromPerTable({ depositos: depositosChain, inventario: invChain })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/search?q=note"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body[0].precioCompra).toBeNull()
    // Sale price stays visible — only cost is gated.
    expect(body[0].precioVenta).toBe(100)
  })

  it("keeps precioCompra for ADMIN (aggregate / verTodas path) — no behavior change", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const invChain = createChainMock([
      {
        id: "i2",
        codigo: "C2",
        nombre: "Cable",
        stock: 10,
        stock_reservado: 0,
        precio_venta: 50,
        precio_compra: 20,
        trackea_series: false,
      },
    ])
    mockFromPerTable({ inventario: invChain })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/search?q=cable"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body[0].precioCompra).toBe(20)
  })

  it("strips precioCompra for VENDEDOR when the org has NOT opted in (vendedores_administran_inventario=false)", async () => {
    mockVendedor()

    const depositosChain = makeDepositosChain("dep-1")
    const invChain = createChainMock([
      {
        id: "i3",
        codigo: "C3",
        nombre: "Funda",
        precio_venta: 200,
        precio_compra: 80,
        trackea_series: false,
        inventario_depositos: [{ stock: 5, stock_reservado: 1, deposito_id: "dep-1" }],
      },
    ])
    mockFromPerTable({ depositos: depositosChain, inventario: invChain, organizations: orgChain(false) })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/search?q=funda"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body[0].precioCompra).toBeNull()
  })

  it("keeps precioCompra for VENDEDOR when the org opted in (vendedores_administran_inventario=true)", async () => {
    mockVendedor()

    const depositosChain = makeDepositosChain("dep-1")
    const invChain = createChainMock([
      {
        id: "i4",
        codigo: "C4",
        nombre: "Funda",
        precio_venta: 200,
        precio_compra: 80,
        trackea_series: false,
        inventario_depositos: [{ stock: 5, stock_reservado: 1, deposito_id: "dep-1" }],
      },
    ])
    mockFromPerTable({ depositos: depositosChain, inventario: invChain, organizations: orgChain(true) })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/search?q=funda"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body[0].precioCompra).toBe(80)
  })
})
