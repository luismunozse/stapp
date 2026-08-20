import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
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

describe("GET /api/inventario/search — cost visibility by role", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNoCookie()
  })

  it("strips precioCompra (null) for TECNICO (sucursal-scoped path)", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "tecnico-1",
        organizationId: "org-1",
        role: "TECNICO",
        sucursalId: "suc-1",
        email: "t@t.com",
      },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as any)

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
    // Venta price stays visible — only cost is gated.
    expect(body[0].precioVenta).toBe(100)
  })

  it("keeps precioCompra for ADMIN (verTodas / aggregate path) — no behavior change", async () => {
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
    mockSupabaseFrom({ inventario: invChain })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/search?q=cable"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body[0].precioCompra).toBe(20)
  })

  it("keeps precioCompra for VENDEDOR (POS product search is out of scope for this change)", async () => {
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
    mockFromPerTable({ depositos: depositosChain, inventario: invChain })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/search?q=funda"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body[0].precioCompra).toBe(80)
  })
})
