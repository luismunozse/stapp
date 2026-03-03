import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/counters", () => ({
  getNextReturnNumber: vi.fn().mockResolvedValue("DEV-000001"),
}))

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    create: vi.fn().mockResolvedValue(undefined),
  })),
}))

import { GET, POST } from "@/app/api/ventas/[id]/devolucion/route"

const createParams = (id: string) => ({ params: Promise.resolve({ id }) })

describe("GET /api/ventas/[id]/devolucion", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when not authenticated", async () => {
    mockAuthError()

    const response = await GET(
      createGetRequest("http://localhost:3000/api/ventas/v1/devolucion"),
      createParams("v1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(401)
  })

  it("returns 404 when sale not found", async () => {
    mockAuthSuccess()

    const ventaChain = createChainMock(null, { code: "PGRST116" })
    mockSupabaseFrom({ ventas: ventaChain })

    const response = await GET(
      createGetRequest("http://localhost:3000/api/ventas/v1/devolucion"),
      createParams("v1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(404)
    expect(body.error).toContain("no encontrada")
  })

  it("returns devoluciones list for a sale", async () => {
    mockAuthSuccess()

    const mockDevoluciones = [
      {
        id: "d1",
        venta_id: "v1",
        numero_devolucion: "DEV-000001",
        motivo: "Producto defectuoso",
        tipo: "PARCIAL",
        monto_devolucion: "1000",
        estado: "COMPLETADA",
        observaciones: null,
        procesado_por: "u1",
        created_at: "2024-01-15",
        items_devolucion: [
          {
            id: "di1",
            devolucion_id: "d1",
            item_venta_id: "i1",
            inventario_id: "inv1",
            cantidad: 1,
            precio_unitario: "1000",
            subtotal: "1000",
            restaurar_stock: true,
          },
        ],
      },
    ]

    const ventaChain = createChainMock({ id: "v1" })
    const devChain = createChainMock(mockDevoluciones)
    devChain.then = (resolve: any) => resolve({ data: mockDevoluciones, error: null })

    mockSupabaseFrom({ ventas: ventaChain, devoluciones_venta: devChain })

    const response = await GET(
      createGetRequest("http://localhost:3000/api/ventas/v1/devolucion"),
      createParams("v1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body).toHaveLength(1)
    expect(body[0].numeroDevolucion).toBe("DEV-000001")
    expect(body[0].items).toHaveLength(1)
  })
})

describe("POST /api/ventas/[id]/devolucion", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when not authenticated", async () => {
    mockAuthError()

    const response = await POST(
      createPostRequest({}),
      createParams("v1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(401)
  })

  it("returns 403 for non-ADMIN role", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })

    const response = await POST(
      createPostRequest({
        motivo: "Test",
        items: [{ itemVentaId: "i1", cantidad: 1, precioUnitario: 1000, restaurarStock: true }],
      }),
      createParams("v1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(403)
    expect(body.error).toContain("administradores")
  })

  it("validates motivo is required", async () => {
    mockAuthSuccess()

    const response = await POST(
      createPostRequest({
        items: [{ itemVentaId: "i1", cantidad: 1, precioUnitario: 1000, restaurarStock: true }],
      }),
      createParams("v1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(400)
  })

  it("validates at least one item required", async () => {
    mockAuthSuccess()

    const response = await POST(
      createPostRequest({
        motivo: "Test motivo",
        items: [],
      }),
      createParams("v1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toContain("al menos un item")
  })

  it("validates cantidad is positive", async () => {
    mockAuthSuccess()

    const response = await POST(
      createPostRequest({
        motivo: "Test",
        items: [{ itemVentaId: "i1", cantidad: 0, precioUnitario: 1000, restaurarStock: true }],
      }),
      createParams("v1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(400)
  })
})
