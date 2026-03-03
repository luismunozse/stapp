import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  parseResponse,
} from "./helpers"

import { GET } from "@/app/api/inventario/[id]/movimientos/route"

const createParams = (id: string) => ({ params: Promise.resolve({ id }) })

describe("GET /api/inventario/[id]/movimientos", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when not authenticated", async () => {
    mockAuthError()

    const response = await GET(
      createGetRequest("http://localhost:3000/api/inventario/inv1/movimientos"),
      createParams("inv1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(401)
  })

  it("returns 404 when inventory item not found", async () => {
    mockAuthSuccess()

    const invChain = createChainMock(null, { code: "PGRST116" })
    mockSupabaseFrom({ inventario: invChain })

    const response = await GET(
      createGetRequest("http://localhost:3000/api/inventario/inv1/movimientos"),
      createParams("inv1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(404)
    expect(body.error).toContain("no encontrado")
  })

  it("returns paginated movement history", async () => {
    mockAuthSuccess()

    const mockMovimientos = [
      {
        id: "m1",
        inventario_id: "inv1",
        tipo: "VENTA",
        cantidad: 2,
        stock_anterior: 10,
        stock_posterior: 8,
        referencia_id: "v1",
        referencia_tipo: "venta",
        observaciones: "Venta V0001",
        usuario_id: "u1",
        users: { id: "u1", nombre: "Test User" },
        created_at: "2024-01-01T10:00:00Z",
      },
      {
        id: "m2",
        inventario_id: "inv1",
        tipo: "AJUSTE",
        cantidad: 5,
        stock_anterior: 8,
        stock_posterior: 13,
        referencia_id: null,
        referencia_tipo: null,
        observaciones: "Ajuste manual",
        usuario_id: "u1",
        users: { id: "u1", nombre: "Test User" },
        created_at: "2024-01-02T10:00:00Z",
      },
    ]

    const invChain = createChainMock({ id: "inv1" })
    const movChain = createChainMock(mockMovimientos, null, 2)
    mockSupabaseFrom({
      inventario: invChain,
      movimientos_inventario: movChain,
    })

    const response = await GET(
      createGetRequest("http://localhost:3000/api/inventario/inv1/movimientos"),
      createParams("inv1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body.data).toHaveLength(2)
    expect(body.data[0].tipo).toBe("VENTA")
    expect(body.data[0].stockAnterior).toBe(10)
    expect(body.data[0].stockPosterior).toBe(8)
    expect(body.data[1].tipo).toBe("AJUSTE")
    expect(body.total).toBe(2)
    expect(body.page).toBe(1)
  })

  it("respects pagination params", async () => {
    mockAuthSuccess()

    const invChain = createChainMock({ id: "inv1" })
    const movChain = createChainMock([], null, 0)
    mockSupabaseFrom({
      inventario: invChain,
      movimientos_inventario: movChain,
    })

    await GET(
      createGetRequest("http://localhost:3000/api/inventario/inv1/movimientos?page=2&limit=10"),
      createParams("inv1")
    )

    // Verify range was called for pagination
    const rangeCalls = movChain.range.mock.calls
    expect(rangeCalls.length).toBeGreaterThan(0)
    // page=2, limit=10 → offset=10, range(10, 19)
    expect(rangeCalls[0][0]).toBe(10)
    expect(rangeCalls[0][1]).toBe(19)
  })
})
