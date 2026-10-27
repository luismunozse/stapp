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

vi.mock("@/lib/webhooks/dispatcher", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

import { PUT } from "@/app/api/ordenes/[id]/route"
import { queueNotification } from "@/lib/notifications/queue"
import { diffObjects } from "@/lib/audit"

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

  it("permite EN_REPARACION sin técnico asignado (técnico no es requerido)", async () => {
    // técnico_id ya no es un campo requerido por la state machine para EN_REPARACION.
    // Solo se requiere costo_final > 0. Orden con costo_final y sin técnico debe pasar.
    mockAuthSuccess()

    const mockOrden = createMockOrden({ estado: "APROBADO", presupuesto: 5000, costo_final: 5000, tecnico_id: null })
    const mockUpdated = { ...mockOrden, estado: "EN_REPARACION" }

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
      createPutRequest({ estado: "EN_REPARACION" }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
  })

  it("permite EN_REPARACION sin costo final (el costo se exige recién en REPARADO)", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrden({ estado: "APROBADO", presupuesto: 5000, costo_final: null, tecnico_id: "t1" })
    const mockUpdated = { ...mockOrden, estado: "EN_REPARACION" }

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
      createPutRequest({ estado: "EN_REPARACION" }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
  })

  it("permite EN_REPARACION si técnico y costoFinal se envían en la misma request", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrden({ estado: "APROBADO", presupuesto: 5000, costo_final: null, tecnico_id: null, sucursal_id: "suc-1" })
    const mockUpdated = { ...mockOrden, estado: "EN_REPARACION", tecnico_id: "t1", costo_final: 5000 }

    let callCount = 0
    const chain = createChainMock(null)
    chain.single = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.resolve({ data: mockOrden, error: null })
      return Promise.resolve({ data: mockUpdated, error: null })
    })

    const usersChain = createChainMock({ id: "t1", rol: "TECNICO", sucursal_id: "suc-1" })
    mockSupabaseFrom({
      ordenes_servicio: chain,
      orden_eventos: createChainMock(null),
      users: usersChain,
    })

    const response = await PUT(
      createPutRequest({ estado: "EN_REPARACION", tecnicoId: "t1", costoFinal: 5000 }),
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

  it("guarda fechaPrometida YYYY-MM-DD anclada a mediodía UTC", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrden({ estado: "RECIBIDO" })
    let callCount = 0
    const chain = createChainMock(null)
    chain.single = vi.fn().mockImplementation(() => {
      callCount++
      return Promise.resolve({ data: mockOrden, error: null })
    })
    mockSupabaseFrom({ ordenes_servicio: chain })

    const response = await PUT(
      createPutRequest({ fechaPrometida: "2030-03-15" }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ fecha_prometida: "2030-03-15T12:00:00.000Z" })
    )
  })

  it("fechaPrometida null limpia la fecha", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrden({ estado: "RECIBIDO", fecha_prometida: "2030-03-15T12:00:00.000Z" })
    const chain = createChainMock(null)
    chain.single = vi.fn().mockResolvedValue({ data: mockOrden, error: null })
    mockSupabaseFrom({ ordenes_servicio: chain })

    const response = await PUT(
      createPutRequest({ fechaPrometida: null }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ fecha_prometida: null })
    )
  })

  it("rechaza presupuesto negativo", async () => {
    mockAuthSuccess()

    const response = await PUT(
      createPutRequest({ presupuesto: -500 }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toContain("negativo")
  })

  it("rechaza costoFinal negativo", async () => {
    mockAuthSuccess()

    const response = await PUT(
      createPutRequest({ costoFinal: -100 }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toContain("negativo")
  })
})

describe("PUT /api/ordenes/[id] - Dedup notificaciones al presupuestar", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("al presupuestar (auto-PRESUPUESTADO) encola PRESUPUESTO_DEFINIDO y NO CAMBIO_ESTADO", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrden({ estado: "EN_DIAGNOSTICO", presupuesto: null })
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
      createPutRequest({ presupuesto: 5000 }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(200)

    const tipos = vi.mocked(queueNotification).mock.calls.map((c) => c[0].tipo)
    expect(tipos).toContain("PRESUPUESTO_DEFINIDO")
    expect(tipos).not.toContain("CAMBIO_ESTADO")
  })
})

describe("PUT /api/ordenes/[id] - Evento de aprobación manual de presupuesto", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("emite PRESUPUESTO_APROBADO (no CAMBIO_ESTADO genérico) al pasar de PRESUPUESTADO a APROBADO", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrden({ estado: "PRESUPUESTADO", presupuesto: 5000 })
    const mockUpdated = { ...mockOrden, estado: "APROBADO" }

    let callCount = 0
    const chain = createChainMock(null)
    chain.single = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.resolve({ data: mockOrden, error: null })
      return Promise.resolve({ data: mockUpdated, error: null })
    })

    const eventosChain = createChainMock(null)
    mockSupabaseFrom({
      ordenes_servicio: chain,
      orden_eventos: eventosChain,
    })

    const response = await PUT(
      createPutRequest({ estado: "APROBADO" }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(200)

    const insertCall = eventosChain.insert.mock.calls.find(
      (call: any[]) => call[0]?.estado_nuevo === "APROBADO"
    )
    expect(insertCall).toBeDefined()
    expect(insertCall![0].tipo).toBe("PRESUPUESTO_APROBADO")
  })

  it("mantiene CAMBIO_ESTADO genérico para transiciones que no son aprobación de presupuesto", async () => {
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

    const eventosChain = createChainMock(null)
    mockSupabaseFrom({
      ordenes_servicio: chain,
      orden_eventos: eventosChain,
    })

    const response = await PUT(
      createPutRequest({ estado: "EN_DIAGNOSTICO" }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(200)

    const insertCall = eventosChain.insert.mock.calls.find(
      (call: any[]) => call[0]?.estado_nuevo === "EN_DIAGNOSTICO"
    )
    expect(insertCall).toBeDefined()
    expect(insertCall![0].tipo).toBe("CAMBIO_ESTADO")
  })
})

describe("PUT /api/ordenes/[id] - Guard costo_final (cobros y estado)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rechaza bajar costoFinal por debajo de lo ya cobrado", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrden({
      estado: "REPARADO",
      costo_final: "25000",
      total_cobrado: "10000",
      descuento_cobro: "0",
    })
    const chain = createChainMock(mockOrden)
    mockSupabaseFrom({ ordenes_servicio: chain })

    const response = await PUT(
      createPutRequest({ costoFinal: 5000 }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toContain("cobrado")
    expect(chain.update).not.toHaveBeenCalled()
  })

  it("rechaza vaciar costoFinal (null) en una orden REPARADO", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrden({
      estado: "REPARADO",
      costo_final: "25000",
      total_cobrado: "0",
      descuento_cobro: "0",
    })
    const chain = createChainMock(mockOrden)
    mockSupabaseFrom({ ordenes_servicio: chain })

    const response = await PUT(
      createPutRequest({ costoFinal: null }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toContain("Reparado")
    expect(chain.update).not.toHaveBeenCalled()
  })

  it("rechaza costoFinal 0 en una orden ya ENTREGADA", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrden({
      estado: "ENTREGADO",
      costo_final: "25000",
      total_cobrado: "0",
      descuento_cobro: "0",
    })
    const chain = createChainMock(mockOrden)
    mockSupabaseFrom({ ordenes_servicio: chain })

    const response = await PUT(
      createPutRequest({ costoFinal: 0 }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(chain.update).not.toHaveBeenCalled()
  })

  it("permite subir costoFinal por encima de lo ya cobrado", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrden({
      estado: "REPARADO",
      costo_final: "25000",
      total_cobrado: "10000",
      descuento_cobro: "0",
    })
    const mockUpdated = { ...mockOrden, costo_final: 30000 }

    let callCount = 0
    const chain = createChainMock(null)
    chain.single = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.resolve({ data: mockOrden, error: null })
      return Promise.resolve({ data: mockUpdated, error: null })
    })

    mockSupabaseFrom({ ordenes_servicio: chain })

    const response = await PUT(
      createPutRequest({ costoFinal: 30000 }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
  })

  it("cuenta las NC activas: no deja el costo por debajo de cobrado + lo que bajaron las NC", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrden({
      estado: "REPARADO",
      costo_final: "25000",
      total_cobrado: "10000",
      descuento_cobro: "0",
      notas_credito: [{ monto_aplicado_deuda: "8000", anulada: false }],
    })
    const chain = createChainMock(mockOrden)
    mockSupabaseFrom({ ordenes_servicio: chain })

    const response = await PUT(createPutRequest({ costoFinal: 15000 }), createParams("o1"))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toContain("cobrado")
    expect(chain.update).not.toHaveBeenCalled()
    expect(chain.select).toHaveBeenCalledWith(expect.stringContaining("notas_credito (monto_aplicado_deuda, anulada)"))
  })

  it("una NC anulada no cuenta para el guard", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrden({
      estado: "REPARADO",
      costo_final: "25000",
      total_cobrado: "10000",
      descuento_cobro: "0",
      notas_credito: [{ monto_aplicado_deuda: "8000", anulada: true }],
    })
    const mockUpdated = { ...mockOrden, costo_final: 15000 }

    let callCount = 0
    const chain = createChainMock(null)
    chain.single = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.resolve({ data: mockOrden, error: null })
      return Promise.resolve({ data: mockUpdated, error: null })
    })
    mockSupabaseFrom({ ordenes_servicio: chain })

    const response = await PUT(createPutRequest({ costoFinal: 15000 }), createParams("o1"))

    expect((await parseResponse(response)).status).toBe(200)
  })

  it("la auditoría no registra el embed de NC como un cambio de la orden", async () => {
    mockAuthSuccess()

    const mockOrden = createMockOrden({
      estado: "REPARADO",
      costo_final: "25000",
      total_cobrado: "0",
      descuento_cobro: "0",
      notas_credito: [{ monto_aplicado_deuda: "0", anulada: false }],
    })
    const mockUpdated = { ...mockOrden, costo_final: 30000 }
    delete (mockUpdated as any).notas_credito

    let callCount = 0
    const chain = createChainMock(null)
    chain.single = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.resolve({ data: mockOrden, error: null })
      return Promise.resolve({ data: mockUpdated, error: null })
    })
    mockSupabaseFrom({ ordenes_servicio: chain })

    await PUT(createPutRequest({ costoFinal: 30000 }), createParams("o1"))

    expect(diffObjects).toHaveBeenCalled()
    expect(vi.mocked(diffObjects).mock.calls[0][0]).not.toHaveProperty("notas_credito")
  })
})
