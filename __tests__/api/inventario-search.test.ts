import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess, mockAuthError, createChainMock, mockSupabaseFrom,
  createGetRequest, parseResponse,
} from "./helpers"
import { GET } from "@/app/api/inventario/search/route"

describe("GET /api/inventario/search", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/search?q=note"))
    const { status } = await parseResponse(res)
    expect(status).toBe(401)
  })

  it("incluye trackeaSeries en el payload", async () => {
    mockAuthSuccess()
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
