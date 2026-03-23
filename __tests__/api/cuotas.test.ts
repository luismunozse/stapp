import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  parseResponse,
} from "./helpers"

import { GET, PUT } from "@/app/api/ordenes/[id]/cuotas/route"

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe("GET /api/ordenes/[id]/cuotas", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const response = await GET(
      createGetRequest("http://localhost:3000/api/ordenes/o1/cuotas"),
      createParams("o1")
    )
    const { status } = await parseResponse(response)
    expect(status).toBe(401)
  })

  it("returns cuotas list", async () => {
    mockAuthSuccess()

    const mockCuotas = [
      {
        id: "cuota-1",
        cobro_id: "c1",
        numero_cuota: 1,
        total_cuotas: 3,
        monto: "1666.67",
        fecha_vencimiento: "2024-02-01",
        pagada: true,
        fecha_pago: "2024-01-15T10:00:00Z",
      },
      {
        id: "cuota-2",
        cobro_id: "c1",
        numero_cuota: 2,
        total_cuotas: 3,
        monto: "1666.67",
        fecha_vencimiento: "2024-03-01",
        pagada: false,
        fecha_pago: null,
      },
      {
        id: "cuota-3",
        cobro_id: "c1",
        numero_cuota: 3,
        total_cuotas: 3,
        monto: "1666.66",
        fecha_vencimiento: "2024-04-01",
        pagada: false,
        fecha_pago: null,
      },
    ]

    const chain = createChainMock(mockCuotas)
    chain.then = (resolve: any) => resolve({ data: mockCuotas, error: null })
    mockSupabaseFrom({ cuotas_cobro: chain })

    const response = await GET(
      createGetRequest("http://localhost:3000/api/ordenes/o1/cuotas"),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body).toHaveLength(3)
    expect(body[0].numeroCuota).toBe(1)
    expect(body[0].pagada).toBe(true)
    expect(body[0].monto).toBe(1666.67)
    expect(body[1].pagada).toBe(false)
  })

  it("returns empty array when no cuotas", async () => {
    mockAuthSuccess()

    const chain = createChainMock([])
    chain.then = (resolve: any) => resolve({ data: [], error: null })
    mockSupabaseFrom({ cuotas_cobro: chain })

    const response = await GET(
      createGetRequest("http://localhost:3000/api/ordenes/o1/cuotas"),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body).toEqual([])
  })
})

describe("PUT /api/ordenes/[id]/cuotas - Marcar pagada", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const response = await PUT(
      new Request("http://localhost:3000/api/ordenes/o1/cuotas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuotaId: "cuota-1" }),
      }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)
    expect(status).toBe(401)
  })

  it("returns 403 when non-admin tries to mark cuota", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    const response = await PUT(
      new Request("http://localhost:3000/api/ordenes/o1/cuotas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuotaId: "cuota-1" }),
      }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)
    expect(status).toBe(403)
    expect(body.error).toContain("administradores")
  })

  it("validates required cuotaId", async () => {
    mockAuthSuccess()
    const response = await PUT(
      new Request("http://localhost:3000/api/ordenes/o1/cuotas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)
    expect(status).toBe(400)
  })

  it("returns 404 when cuota not found", async () => {
    mockAuthSuccess()
    const chain = createChainMock(null, { message: "not found" })
    mockSupabaseFrom({ cuotas_cobro: chain })

    const response = await PUT(
      new Request("http://localhost:3000/api/ordenes/o1/cuotas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuotaId: "nonexistent" }),
      }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)
    expect(status).toBe(404)
  })

  it("returns 400 when cuota already paid", async () => {
    mockAuthSuccess()
    const chain = createChainMock({ id: "cuota-1", pagada: true })
    mockSupabaseFrom({ cuotas_cobro: chain })

    const response = await PUT(
      new Request("http://localhost:3000/api/ordenes/o1/cuotas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuotaId: "cuota-1" }),
      }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)
    expect(status).toBe(400)
    expect(body.error).toContain("ya fue marcada")
  })

  it("marks cuota as paid successfully", async () => {
    mockAuthSuccess()

    const cuotasChain = createChainMock({ id: "cuota-2", pagada: false })
    mockSupabaseFrom({ cuotas_cobro: cuotasChain })

    const response = await PUT(
      new Request("http://localhost:3000/api/ordenes/o1/cuotas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuotaId: "cuota-2" }),
      }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body.message).toContain("pagada")
  })
})
