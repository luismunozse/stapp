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

vi.mock("@/lib/inngest", () => ({
  queueNotification: vi.fn().mockResolvedValue(undefined),
}))

import { PUT } from "@/app/api/ordenes/[id]/route"

function createPutRequest(body: any, url?: string) {
  return new Request(url || "http://localhost:3000/api/ordenes/o1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function createMockOrden(overrides: Record<string, any> = {}) {
  return {
    id: "o1",
    numero_orden: 1,
    codigo_orden: "CEL-001",
    cliente_id: "c1",
    tecnico_id: "t1",
    organization_id: "org-1",
    tipo_dispositivo: "CELULAR",
    dispositivo: "iPhone 13",
    problema_reportado: "Pantalla rota",
    estado: "RECIBIDO",
    presupuesto: null,
    costo_final: null,
    fecha_ingreso: "2024-01-01",
    fecha_prometida: null,
    fecha_completado: null,
    clientes: { id: "c1", nombre: "Juan", email: "j@test.com", telefono: "123" },
    organizations: { id: "org-1", nombre: "Taller", moneda: "ARS", zona_horaria: "America/Argentina/Buenos_Aires" },
    ...overrides,
  }
}

describe("PUT /api/ordenes/[id] - State Machine", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rechaza transición inválida RECIBIDO -> ENTREGADO", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrden({ estado: "RECIBIDO" })
    const chain = createChainMock(mockOrden)
    mockSupabaseFrom({ ordenes_servicio: chain })

    const response = await PUT(
      createPutRequest({ estado: "ENTREGADO" }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toContain("RECIBIDO")
    expect(body.error).toContain("ENTREGADO")
  })

  it("permite transición válida RECIBIDO -> EN_DIAGNOSTICO", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrden({ estado: "RECIBIDO" })
    const mockUpdated = { ...mockOrden, estado: "EN_DIAGNOSTICO" }

    let callCount = 0
    const chain = createChainMock(null)
    chain.single = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.resolve({ data: mockOrden, error: null })
      return Promise.resolve({ data: mockUpdated, error: null })
    })

    mockSupabaseFrom({
      ordenes_servicio: chain,
      orden_eventos: createChainMock(null),
    })

    const response = await PUT(
      createPutRequest({ estado: "EN_DIAGNOSTICO" }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
  })

  it("rechaza transición PRESUPUESTADO -> EN_REPARACION (debe ir a APROBADO)", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrden({ estado: "PRESUPUESTADO", presupuesto: 5000 })
    const chain = createChainMock(mockOrden)
    mockSupabaseFrom({ ordenes_servicio: chain })

    const response = await PUT(
      createPutRequest({ estado: "EN_REPARACION" }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toContain("PRESUPUESTADO")
  })

  it("rechaza transición desde ENTREGADO (terminal)", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrden({ estado: "ENTREGADO" })
    const chain = createChainMock(mockOrden)
    mockSupabaseFrom({ ordenes_servicio: chain })

    const response = await PUT(
      createPutRequest({ estado: "RECIBIDO" }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toContain("no puede cambiar")
  })

  it("permite reactivar orden cancelada -> RECIBIDO", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrden({ estado: "CANCELADO" })
    const mockUpdated = { ...mockOrden, estado: "RECIBIDO" }

    let callCount = 0
    const chain = createChainMock(null)
    chain.single = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.resolve({ data: mockOrden, error: null })
      return Promise.resolve({ data: mockUpdated, error: null })
    })

    mockSupabaseFrom({
      ordenes_servicio: chain,
      orden_eventos: createChainMock(null),
    })

    const response = await PUT(
      createPutRequest({ estado: "RECIBIDO" }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
  })
})

describe("PUT /api/ordenes/[id] - Campos Requeridos", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rechaza PRESUPUESTADO sin presupuesto definido", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrden({ estado: "RECIBIDO", presupuesto: null })
    const chain = createChainMock(mockOrden)
    mockSupabaseFrom({ ordenes_servicio: chain })

    const response = await PUT(
      createPutRequest({ estado: "PRESUPUESTADO" }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toContain("Presupuesto")
  })

  it("permite PRESUPUESTADO si presupuesto se envía en la misma request", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrden({ estado: "RECIBIDO", presupuesto: null })
    const mockUpdated = { ...mockOrden, estado: "PRESUPUESTADO", presupuesto: 5000 }

    let callCount = 0
    const chain = createChainMock(null)
    chain.single = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.resolve({ data: mockOrden, error: null })
      return Promise.resolve({ data: mockUpdated, error: null })
    })

    mockSupabaseFrom({
      ordenes_servicio: chain,
      orden_eventos: createChainMock(null),
    })

    const response = await PUT(
      createPutRequest({ estado: "PRESUPUESTADO", presupuesto: 5000 }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
  })

  it("rechaza EN_REPARACION sin técnico asignado", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrden({ estado: "APROBADO", presupuesto: 5000, tecnico_id: null })
    const chain = createChainMock(mockOrden)
    mockSupabaseFrom({ ordenes_servicio: chain })

    const response = await PUT(
      createPutRequest({ estado: "EN_REPARACION" }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toContain("Técnico")
  })

  it("permite EN_REPARACION si técnico se envía en la misma request", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrden({ estado: "APROBADO", presupuesto: 5000, tecnico_id: null })
    const mockUpdated = { ...mockOrden, estado: "EN_REPARACION", tecnico_id: "t1" }

    let callCount = 0
    const chain = createChainMock(null)
    chain.single = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.resolve({ data: mockOrden, error: null })
      return Promise.resolve({ data: mockUpdated, error: null })
    })

    mockSupabaseFrom({
      ordenes_servicio: chain,
      orden_eventos: createChainMock(null),
    })

    const response = await PUT(
      createPutRequest({ estado: "EN_REPARACION", tecnicoId: "t1" }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
  })

  it("rechaza REPARADO sin costo final", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrden({
      estado: "EN_REPARACION",
      presupuesto: 5000,
      tecnico_id: "t1",
      costo_final: null,
    })
    const chain = createChainMock(mockOrden)
    mockSupabaseFrom({ ordenes_servicio: chain })

    const response = await PUT(
      createPutRequest({ estado: "REPARADO" }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toContain("Costo final")
  })

  it("permite REPARADO con costo final existente en la orden", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrden({
      estado: "EN_REPARACION",
      presupuesto: 5000,
      tecnico_id: "t1",
      costo_final: 4500,
    })
    const mockUpdated = { ...mockOrden, estado: "REPARADO", fecha_completado: new Date().toISOString() }

    let callCount = 0
    const chain = createChainMock(null)
    chain.single = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.resolve({ data: mockOrden, error: null })
      return Promise.resolve({ data: mockUpdated, error: null })
    })

    mockSupabaseFrom({
      ordenes_servicio: chain,
      orden_eventos: createChainMock(null),
    })

    const response = await PUT(
      createPutRequest({ estado: "REPARADO" }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
  })

  it("no valida campos al actualizar sin cambio de estado", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrden({ estado: "RECIBIDO" })
    const mockUpdated = { ...mockOrden, observaciones: "Nota nueva" }

    let callCount = 0
    const chain = createChainMock(null)
    chain.single = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.resolve({ data: mockOrden, error: null })
      return Promise.resolve({ data: mockUpdated, error: null })
    })

    mockSupabaseFrom({ ordenes_servicio: chain })

    const response = await PUT(
      createPutRequest({ observaciones: "Nota nueva" }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
  })
})
