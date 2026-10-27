/**
 * A technician that was removed (users.deleted_at set) cannot receive orders:
 * the lookups that validate an assignment must exclude removed users, so a
 * removed technician is rejected exactly like an unknown one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/plan-limits", () => ({
  enforcePlanLimit: vi.fn().mockResolvedValue(null),
}))
vi.mock("@/lib/counters", () => ({
  getNextOrderNumberByType: vi.fn().mockResolvedValue({ codigo: "CEL-001", numero: 1 }),
}))
vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  })),
  diffObjects: vi.fn().mockReturnValue({ before: {}, after: {} }),
}))
vi.mock("@/lib/storage", () => ({
  uploadOrderPhoto: vi.fn().mockResolvedValue({ url: "u", path: "p" }),
  base64ToBuffer: vi.fn().mockReturnValue(Buffer.from("fake")),
}))
vi.mock("@/lib/push/send", () => ({
  sendPushToUsers: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/notifications/queue", () => ({
  queueNotification: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/webhooks/dispatcher", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/tipos-dispositivo-config", () => ({
  tipoValidaImei: vi.fn(),
}))

import { POST } from "@/app/api/ordenes/route"
import { PUT } from "@/app/api/ordenes/[id]/route"
import { POST as REASIGNAR } from "@/app/api/tecnicos/[id]/reasignar/route"

describe("assigning an order to a removed technician", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
  })

  it("POST /api/ordenes rejects it like an unknown technician", async () => {
    const users = createChainMock(null)
    mockSupabaseFrom({ users })
    const res = await POST(
      createPostRequest({
        clienteId: "c1",
        dispositivo: "iPhone 14",
        tipoDispositivo: "CELULAR",
        problemaReportado: "No enciende",
        tecnicoId: "t-baja",
      })
    )
    const { status, body } = await parseResponse(res)
    expect(status).toBe(400)
    expect(body.error).toBe("Técnico inválido")
    expect(users.is).toHaveBeenCalledWith("deleted_at", null)
  })

  it("PUT /api/ordenes/[id] rejects reassigning to a removed technician", async () => {
    const orden = {
      id: "o1",
      estado: "RECIBIDO",
      tecnico_id: "t1",
      organization_id: "org-1",
      clientes: { id: "c1", nombre: "Juan" },
      organizations: { id: "org-1", nombre: "Taller", moneda: "ARS" },
    }
    const ordenes = createChainMock(orden)
    const users = createChainMock(null)
    mockSupabaseFrom({ ordenes_servicio: ordenes, orden_eventos: createChainMock(null), users })
    const res = await PUT(
      new Request("http://localhost:3000/api/ordenes/o1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tecnicoId: "t-baja" }),
      }),
      { params: Promise.resolve({ id: "o1" }) }
    )
    const { status, body } = await parseResponse(res)
    expect(status).toBe(400)
    expect(body.error).toBe("El técnico seleccionado no existe")
    expect(users.is).toHaveBeenCalledWith("deleted_at", null)
  })

  it("POST /api/tecnicos/[id]/reasignar rejects a removed destination", async () => {
    const users = createChainMock(null, { message: "no rows" })
    mockSupabaseFrom({ users })
    const res = await REASIGNAR(
      createPostRequest({ tecnicoDestinoId: "t-baja" }, "http://localhost:3000/api/tecnicos/t1/reasignar"),
      { params: Promise.resolve({ id: "t1" }) }
    )
    const { status } = await parseResponse(res)
    expect(status).toBe(404)
    expect(users.is).toHaveBeenCalledWith("deleted_at", null)
  })
})
