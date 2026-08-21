import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, createGetRequest, parseResponse } from "./helpers"
import { GET } from "@/app/api/inventario/barcode/route"

/**
 * /api/inventario/barcode guards with plain requireAuth(): a TECNICO scanning a
 * code — or just calling the endpoint — reaches it. The route returns the
 * shared inventario formatter verbatim, so before this gate it handed back the
 * exact precioCompra that /api/inventario/[id] refuses to that role.
 *
 * The endpoint feeds the POS cart and the stock-count scanner; neither reads
 * precioCompra, so the cost is simply never included here for any role. That
 * falls out of formatInventario being opt-in for cost, which is what keeps the
 * next endpoint added on top of the formatter safe by default.
 */

function mockNoCookie() {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn(() => undefined),
    set: vi.fn(),
  } as any)
}

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

function makeInventarioChain(rows: any[]) {
  const chain: any = {}
  for (const m of ["select", "eq", "ilike", "is", "order", "limit"]) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.then = (resolve: any) => Promise.resolve({ data: rows, error: null }).then(resolve)
  chain.catch = (reject: any) => Promise.resolve({ data: rows, error: null }).catch(reject)
  return chain
}

function makeMaybeSingleChain(data: any) {
  const chain: any = {}
  for (const m of ["select", "eq", "is"]) chain[m] = vi.fn().mockReturnValue(chain)
  chain.maybeSingle = vi.fn().mockResolvedValue({ data, error: null })
  return chain
}

async function scan() {
  const invChain = makeInventarioChain([ITEM_ROW])
  // Non-ADMIN roles are always branch-scoped, so the route resolves the
  // sucursal deposito. Keep its stock equal to the aggregate so the assertions
  // below are about the cost gate and nothing else.
  const depositosChain = makeMaybeSingleChain({ id: "dep-1" })
  const depStockChain = makeMaybeSingleChain({ stock: 10, stock_reservado: 1 })

  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "depositos") return depositosChain as any
    if (table === "inventario_depositos") return depStockChain as any
    return invChain as any
  })

  const res = await GET(
    createGetRequest("http://localhost:3000/api/inventario/barcode?code=7890001234567")
  )
  return parseResponse(res)
}

describe("GET /api/inventario/barcode — purchase cost never leaves the endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNoCookie()
  })

  it("strips precioCompra for TECNICO — never gets inventario cost access", async () => {
    mockAuthSuccess({ role: "TECNICO" })

    const { status, body } = await scan()

    expect(status).toBe(200)
    expect(body.item.precioCompra).toBeNull()
    // Everything the POS actually consumes survives.
    expect(body.item.precioVenta).toBe(500)
    expect(body.item.stock).toBe(10)
    expect(body.item.nombre).toBe("Producto Test")
  })

  it("strips precioCompra for VENDEDOR without the inventario opt-in", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "v1", organizationId: "org-1", role: "VENDEDOR", email: "v@v.com" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as any)
    mockNoCookie()

    const { status, body } = await scan()

    expect(status).toBe(200)
    expect(body.item.precioCompra).toBeNull()
    expect(body.item.precioVenta).toBe(500)
  })

  it("strips precioCompra for ADMIN too — no consumer of this endpoint needs it", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const { status, body } = await scan()

    expect(status).toBe(200)
    expect(body.item.precioCompra).toBeNull()
    expect(body.item.stock).toBe(10)
  })
})
