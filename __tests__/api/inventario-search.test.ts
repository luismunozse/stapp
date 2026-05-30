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
})
