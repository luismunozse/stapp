import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  mockAuthSuccess,
  mockSupabaseFrom,
  createChainMock,
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

function ctx(id = "o1") {
  return { params: Promise.resolve({ id }) }
}

describe("PUT /api/ordenes/[id] labor cost", () => {
  beforeEach(() => vi.clearAllMocks())

  it("snapshots the technician costo_hora onto the order when assigning", async () => {
    mockAuthSuccess()
    const ordenChain = createChainMock({
      id: "o1", organization_id: "org-1", tecnico_id: null, estado: "RECIBIDO",
      clientes: { id: "c-1", nombre: "Test", email: null, telefono: null },
      organizations: { id: "org-1", nombre: "Org", nombre_mostrar: "Org", slug: "org", moneda: "ARS", zona_horaria: "America/Argentina/Buenos_Aires" },
    })
    const usersChain = createChainMock({ id: "tec-1", rol: "TECNICO", porcentaje_comision: 10, costo_hora: 1500 })
    mockSupabaseFrom({ ordenes_servicio: ordenChain, users: usersChain })

    const req = createPostRequest({ tecnicoId: "tec-1" }, "http://localhost:3000/api/ordenes/o1")
    const res = await PUT(req, ctx())
    const { status } = await parseResponse(res)
    expect(status).toBe(200)
    expect(ordenChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ costo_hora_snapshot: 1500 })
    )
  })

  it("persists horasTrabajadas", async () => {
    mockAuthSuccess()
    const ordenChain = createChainMock({
      id: "o1", organization_id: "org-1", tecnico_id: "tec-1", estado: "EN_REPARACION",
      clientes: { id: "c-1", nombre: "Test", email: null, telefono: null },
      organizations: { id: "org-1", nombre: "Org", nombre_mostrar: "Org", slug: "org", moneda: "ARS", zona_horaria: "America/Argentina/Buenos_Aires" },
    })
    mockSupabaseFrom({ ordenes_servicio: ordenChain, users: createChainMock(null) })

    const req = createPostRequest({ horasTrabajadas: 2.5 }, "http://localhost:3000/api/ordenes/o1")
    const res = await PUT(req, ctx())
    const { status } = await parseResponse(res)
    expect(status).toBe(200)
    expect(ordenChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ horas_trabajadas: 2.5 })
    )
  })

  it("nulls costo_hora_snapshot when de-assigning the technician", async () => {
    mockAuthSuccess()
    const ordenChain = createChainMock({
      id: "o1", organization_id: "org-1", tecnico_id: "tec-1", estado: "RECIBIDO",
      clientes: { id: "c-1", nombre: "Test", email: null, telefono: null },
      organizations: { id: "org-1", nombre: "Org", nombre_mostrar: "Org", slug: "org", moneda: "ARS", zona_horaria: "America/Argentina/Buenos_Aires" },
    })
    mockSupabaseFrom({ ordenes_servicio: ordenChain, users: createChainMock(null) })

    const req = createPostRequest({ tecnicoId: null }, "http://localhost:3000/api/ordenes/o1")
    const res = await PUT(req, ctx())
    expect(ordenChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ costo_hora_snapshot: null })
    )
  })
})
