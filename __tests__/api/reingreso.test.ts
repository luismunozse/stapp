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
    create: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock("@/lib/counters", () => ({
  getNextOrderNumberByType: vi.fn().mockResolvedValue({ codigo: "CEL-002", numero: 2 }),
}))

vi.mock("@/lib/plan-limits", () => ({
  enforcePlanLimit: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/sucursal", () => ({
  getPrincipalId: vi.fn().mockResolvedValue("suc-1"),
}))

import { POST } from "@/app/api/ordenes/[id]/reingreso/route"

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function createMockOrdenOriginal(overrides: Record<string, any> = {}) {
  return {
    id: "o1",
    numero_orden: 1,
    codigo_orden: "CEL-001",
    cliente_id: "c1",
    organization_id: "org-1",
    tipo_dispositivo: "CELULAR",
    dispositivo: "iPhone 13",
    problema_reportado: "Pantalla rota",
    estado: "ENTREGADO",
    presupuesto: 5000,
    costo_final: 5000,
    marca: "Apple",
    color: "Negro",
    imei: "123456789",
    accesorios: "Cargador",
    password_dispositivo: "1234",
    metadata: {},
    sector_id: null,
    sucursal_id: "suc-1",
    clientes: { id: "c1", nombre: "Juan" },
    ...overrides,
  }
}

describe("POST /api/ordenes/[id]/reingreso", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const response = await POST(
      createPostRequest({ problemaReportado: "Problema recurrente" }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)
    expect(status).toBe(401)
  })

  it("returns 404 when original order not found", async () => {
    mockAuthSuccess()
    const chain = createChainMock(null, { message: "not found" })
    mockSupabaseFrom({ ordenes_servicio: chain })

    const response = await POST(
      createPostRequest({ problemaReportado: "Problema recurrente" }),
      createParams("nonexistent")
    )
    const { status } = await parseResponse(response)
    expect(status).toBe(404)
  })

  it("rejects re-ingreso from RECIBIDO state", async () => {
    mockAuthSuccess()
    const mockOrden = createMockOrdenOriginal({ estado: "RECIBIDO" })
    const chain = createChainMock(mockOrden)
    mockSupabaseFrom({ ordenes_servicio: chain })

    const response = await POST(
      createPostRequest({ problemaReportado: "Problema recurrente" }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)
    expect(status).toBe(400)
    expect(body.error).toContain("entregadas o reparadas")
  })

  it("rejects re-ingreso from EN_REPARACION state", async () => {
    mockAuthSuccess()
    const mockOrden = createMockOrdenOriginal({ estado: "EN_REPARACION" })
    const chain = createChainMock(mockOrden)
    mockSupabaseFrom({ ordenes_servicio: chain })

    const response = await POST(
      createPostRequest({ problemaReportado: "Problema recurrente" }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)
    expect(status).toBe(400)
  })

  it("allows re-ingreso from ENTREGADO state", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrdenOriginal({ estado: "ENTREGADO" })
    const mockNuevaOrden = {
      id: "o2",
      numero_orden: 2,
      codigo_orden: "CEL-002",
      es_reingreso: true,
      orden_origen_id: "o1",
      clientes: { id: "c1", nombre: "Juan" },
    }

    const ordenChain = createChainMock(null)
    let singleCallCount = 0
    ordenChain.single = vi.fn().mockImplementation(() => {
      singleCallCount++
      if (singleCallCount === 1) return Promise.resolve({ data: mockOrden, error: null })
      return Promise.resolve({ data: mockNuevaOrden, error: null })
    })

    const eventosChain = createChainMock(null)
    eventosChain.then = (resolve: any) => resolve({ data: null, error: null })

    mockSupabaseFrom({
      ordenes_servicio: ordenChain,
      orden_eventos: eventosChain,
    })

    const response = await POST(
      createPostRequest({ problemaReportado: "Problema recurrente" }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(201)
    expect(body.codigoOrden).toBe("CEL-002")
    expect(body.id).toBe("o2")
  })

  it("inserts a creation event on the new reingreso order (in addition to the origin NOTA)", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrdenOriginal({ estado: "ENTREGADO" })
    const mockNuevaOrden = {
      id: "o2",
      numero_orden: 2,
      codigo_orden: "CEL-002",
      es_reingreso: true,
      orden_origen_id: "o1",
      clientes: { id: "c1", nombre: "Juan" },
    }

    const ordenChain = createChainMock(null)
    let singleCallCount = 0
    ordenChain.single = vi.fn().mockImplementation(() => {
      singleCallCount++
      if (singleCallCount === 1) return Promise.resolve({ data: mockOrden, error: null })
      return Promise.resolve({ data: mockNuevaOrden, error: null })
    })

    const eventosChain = createChainMock(null)
    eventosChain.then = (resolve: any) => resolve({ data: null, error: null })
    const insertSpy = vi.fn().mockReturnValue(eventosChain)
    eventosChain.insert = insertSpy

    mockSupabaseFrom({
      ordenes_servicio: ordenChain,
      orden_eventos: eventosChain,
    })

    const response = await POST(
      createPostRequest({ problemaReportado: "Problema recurrente" }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)
    expect(status).toBe(201)

    expect(insertSpy).toHaveBeenCalledTimes(2)
    const creationEventCall = insertSpy.mock.calls.find((call: any) => call[0].orden_id === "o2")
    expect(creationEventCall).toBeDefined()
    expect(creationEventCall![0].tipo).toBe("CAMBIO_ESTADO")
    expect(creationEventCall![0].estado_nuevo).toBe("RECIBIDO")
    expect(creationEventCall![0].estado_anterior).toBeUndefined()

    const origenEventCall = insertSpy.mock.calls.find((call: any) => call[0].orden_id === "o1")
    expect(origenEventCall).toBeDefined()
    expect(origenEventCall![0].tipo).toBe("NOTA")
  })

  it("allows re-ingreso from REPARADO state", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrdenOriginal({ estado: "REPARADO" })
    const mockNuevaOrden = {
      id: "o3",
      numero_orden: 3,
      codigo_orden: "CEL-002",
      es_reingreso: true,
      orden_origen_id: "o1",
      clientes: { id: "c1", nombre: "Juan" },
    }

    const ordenChain = createChainMock(null)
    let singleCallCount = 0
    ordenChain.single = vi.fn().mockImplementation(() => {
      singleCallCount++
      if (singleCallCount === 1) return Promise.resolve({ data: mockOrden, error: null })
      return Promise.resolve({ data: mockNuevaOrden, error: null })
    })

    const eventosChain = createChainMock(null)
    eventosChain.then = (resolve: any) => resolve({ data: null, error: null })

    mockSupabaseFrom({
      ordenes_servicio: ordenChain,
      orden_eventos: eventosChain,
    })

    const response = await POST(
      createPostRequest({
        problemaReportado: "Pantalla volvió a fallar",
        garantiaId: "g1",
        observaciones: "Garantía vigente",
      }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(201)
  })

  it("validates required problemaReportado field", async () => {
    mockAuthSuccess()
    const response = await POST(
      createPostRequest({}),
      createParams("o1")
    )
    const { status } = await parseResponse(response)
    expect(status).toBe(400)
  })
})
