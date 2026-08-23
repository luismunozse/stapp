import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, createChainMock, createGetRequest, parseResponse } from "./helpers"
import { GET } from "@/app/api/inventario/barcode/route"

/**
 * /api/inventario/barcode guards with plain requireAuth(): a TECNICO scanning a
 * code — or just calling the endpoint — reaches it. The route returns the
 * shared inventario formatter verbatim, so before this gate it handed back the
 * exact precioCompra that /api/inventario/[id] refuses to that role.
 *
 * The cost cannot simply be dropped for everyone either: the inventory list
 * scanner feeds `result.item` straight into the edit dialog, and the form PUTs
 * the whole object back. A null cost there is written to the database as 0.
 * So the route opts into the formatter's cost behind hasInventarioAccess,
 * exactly like its sibling read endpoints.
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

async function scan(options: { vendedoresHabilitados?: boolean } = {}) {
  const invChain = makeInventarioChain([ITEM_ROW])
  // Non-ADMIN roles are always branch-scoped, so the route resolves the
  // sucursal deposito. Keep its stock equal to the aggregate so the assertions
  // below are about the cost gate and nothing else.
  const depositosChain = makeMaybeSingleChain({ id: "dep-1" })
  const depStockChain = makeMaybeSingleChain({ stock: 10, stock_reservado: 1 })
  // organizations chain used by resolveVendedoresHabilitados()
  const orgsChain = createChainMock({
    vendedores_administran_inventario: options.vendedoresHabilitados === true,
  })

  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "depositos") return depositosChain as any
    if (table === "inventario_depositos") return depStockChain as any
    if (table === "organizations") return orgsChain as any
    return invChain as any
  })

  const res = await GET(
    createGetRequest("http://localhost:3000/api/inventario/barcode?code=7890001234567")
  )
  return parseResponse(res)
}

describe("GET /api/inventario/barcode — purchase cost follows hasInventarioAccess", () => {
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

    const { status, body } = await scan({ vendedoresHabilitados: false })

    expect(status).toBe(200)
    expect(body.item.precioCompra).toBeNull()
    expect(body.item.precioVenta).toBe(500)
  })

  it("keeps precioCompra for VENDEDOR when the org opted in", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "v1", organizationId: "org-1", role: "VENDEDOR", email: "v@v.com" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as any)
    mockNoCookie()

    const { status, body } = await scan({ vendedoresHabilitados: true })

    expect(status).toBe(200)
    expect(body.item.precioCompra).toBe(200)
  })

  it("keeps precioCompra for ADMIN — the list scanner PUTs this object back", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const { status, body } = await scan()

    expect(status).toBe(200)
    expect(body.item.precioCompra).toBe(200)
    expect(body.item.stock).toBe(10)
  })
})
