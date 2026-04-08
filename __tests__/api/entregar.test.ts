import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    update: vi.fn().mockResolvedValue(undefined),
  })),
  diffObjects: vi.fn().mockReturnValue({ before: {}, after: {} }),
}))

vi.mock("@/lib/notifications/queue", () => ({
  queueNotification: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from "@/app/api/ordenes/[id]/entregar/route"

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe("POST /api/ordenes/[id]/entregar", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when not authenticated", async () => {
    mockAuthError()

    const response = await POST(
      createPostRequest({
        firmaClienteEntrega: "base64sig",
        firmaClienteMime: "image/png",
        firmaEncargadoEntrega: "base64sig",
        firmaEncargadoMime: "image/png",
      }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(401)
  })

  it("validates required fields", async () => {
    mockAuthSuccess()

    const response = await POST(
      createPostRequest({}),
      createParams("o1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(400)
  })

  it("returns 404 when order not found", async () => {
    mockAuthSuccess()

    const chain = createChainMock(null, { message: "not found" })
    mockSupabaseFrom({ ordenes_servicio: chain })

    const response = await POST(
      createPostRequest({
        firmaClienteEntrega: "base64sig",
        firmaClienteMime: "image/png",
        firmaEncargadoEntrega: "base64sig",
        firmaEncargadoMime: "image/png",
      }),
      createParams("nonexistent")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(404)
    expect(body.error).toContain("Orden no encontrada")
  })

  it("returns 403 when TECNICO tries to deliver another's order", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "tecnico-1" })

    const mockOrden = {
      id: "o1",
      estado: "REPARADO",
      tecnico_id: "tecnico-2",
      clientes: { id: "c1", nombre: "Test" },
    }

    const chain = createChainMock(mockOrden)
    mockSupabaseFrom({ ordenes_servicio: chain })

    const response = await POST(
      createPostRequest({
        firmaClienteEntrega: "base64sig",
        firmaClienteMime: "image/png",
        firmaEncargadoEntrega: "base64sig",
        firmaEncargadoMime: "image/png",
      }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(403)
    expect(body.error).toContain("No autorizado")
  })

  it("returns 400 when order already delivered", async () => {
    mockAuthSuccess()

    const mockOrden = {
      id: "o1",
      estado: "ENTREGADO",
      tecnico_id: "t1",
      clientes: { id: "c1", nombre: "Test" },
    }

    const chain = createChainMock(mockOrden)
    mockSupabaseFrom({ ordenes_servicio: chain })

    const response = await POST(
      createPostRequest({
        firmaClienteEntrega: "base64sig",
        firmaClienteMime: "image/png",
        firmaEncargadoEntrega: "base64sig",
        firmaEncargadoMime: "image/png",
      }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toContain("ya fue entregada")
  })

  it("returns 400 when order is not REPARADO", async () => {
    mockAuthSuccess()

    const mockOrden = {
      id: "o1",
      estado: "EN_REPARACION",
      tecnico_id: "t1",
      clientes: { id: "c1", nombre: "Test" },
    }

    const chain = createChainMock(mockOrden)
    mockSupabaseFrom({ ordenes_servicio: chain })

    const response = await POST(
      createPostRequest({
        firmaClienteEntrega: "base64sig",
        firmaClienteMime: "image/png",
        firmaEncargadoEntrega: "base64sig",
        firmaEncargadoMime: "image/png",
      }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toContain("REPARADO")
  })

  it("delivers order successfully", async () => {
    mockAuthSuccess({ userId: "user-1" })

    const mockOrden = {
      id: "o1",
      estado: "REPARADO",
      numero_orden: 1,
      tecnico_id: "t1",
      clientes: {
        id: "c1",
        nombre: "Juan",
        email: "juan@test.com",
        telefono: "123",
      },
    }

    const mockUpdated = {
      id: "o1",
      numero_orden: 1,
      codigo_orden: "CEL-001",
      estado: "ENTREGADO",
      fecha_entrega: new Date().toISOString(),
      notas_entrega: "Entregado sin problemas",
      users: { id: "user-1", nombre: "Admin" },
      clientes: mockOrden.clientes,
    }

    let callCount = 0
    const chain = createChainMock(null)
    chain.single = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.resolve({ data: mockOrden, error: null })
      if (callCount === 2) return Promise.resolve({ data: mockUpdated, error: null })
      return Promise.resolve({ data: { nombre: "Mi Taller" }, error: null })
    })

    mockSupabaseFrom({
      ordenes_servicio: chain,
      organizations: createChainMock({ nombre: "Mi Taller", moneda: "ARS", zona_horaria: "America/Argentina/Buenos_Aires" }),
    })

    const response = await POST(
      createPostRequest({
        firmaClienteEntrega: "base64data",
        firmaClienteMime: "image/png",
        firmaEncargadoEntrega: "base64data",
        firmaEncargadoMime: "image/png",
        notasEntrega: "Entregado sin problemas",
      }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body.estado).toBe("ENTREGADO")
    expect(body.notasEntrega).toBe("Entregado sin problemas")
  })
})
