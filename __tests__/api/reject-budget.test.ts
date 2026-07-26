import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockSupabaseFrom, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/notifications/queue", () => ({
  queueNotification: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/public-token", () => ({
  getOrderByPublicToken: vi.fn(),
}))

import { queueNotification } from "@/lib/notifications/queue"
import { getOrderByPublicToken } from "@/lib/public-token"
import { POST } from "@/app/api/public/ordenes/[token]/reject-budget/route"

function createParams(token: string) {
  return { params: Promise.resolve({ token }) }
}

const ordenBase = {
  id: "o1",
  estado: "PRESUPUESTADO",
  presupuesto: 5000,
  organization_id: "org-1",
  cliente_id: "c1",
  sucursal_id: "suc-1",
  numero_orden: 5,
  dispositivo: "iPhone",
  public_token: "tok",
  clientes: { id: "c1", nombre: "Juan", email: null, telefono: "123" },
  organizations: { nombre: "Taller", moneda: "ARS", zona_horaria: "America/Argentina/Buenos_Aires" },
}

describe("POST /api/public/ordenes/[token]/reject-budget", () => {
  beforeEach(() => vi.clearAllMocks())

  it("revierte atómicamente PRESUPUESTADO -> EN_DIAGNOSTICO y registra evento + notif", async () => {
    vi.mocked(getOrderByPublicToken).mockResolvedValue({ orden: ordenBase, error: null } as any)
    const ordenes = createChainMock([{ id: "o1" }])
    const cotizaciones = createChainMock(null)
    const eventos = createChainMock(null)
    mockSupabaseFrom({ ordenes_servicio: ordenes, cotizaciones, orden_eventos: eventos })

    const res = await POST(createPostRequest({ motivo: "Muy caro" }), createParams("tok"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.estado).toBe("EN_DIAGNOSTICO")
    expect(ordenes.update).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "EN_DIAGNOSTICO" })
    )
    expect(ordenes.eq).toHaveBeenCalledWith("estado", "PRESUPUESTADO")
    expect(eventos.insert).toHaveBeenCalled()
    expect(queueNotification).toHaveBeenCalled()
  })

  it("rechaza (400) si la orden no está en PRESUPUESTADO", async () => {
    vi.mocked(getOrderByPublicToken).mockResolvedValue({
      orden: { ...ordenBase, estado: "APROBADO" }, error: null,
    } as any)
    mockSupabaseFrom({ ordenes_servicio: createChainMock([{ id: "o1" }]) })

    const res = await POST(createPostRequest({}), createParams("tok"))
    const { status } = await parseResponse(res)
    expect(status).toBe(400)
  })

  it("es idempotente (no evento/notif) si el UPDATE atómico afecta 0 filas (race)", async () => {
    vi.mocked(getOrderByPublicToken).mockResolvedValue({ orden: ordenBase, error: null } as any)
    const ordenes = createChainMock([])
    const cotizaciones = createChainMock(null)
    const eventos = createChainMock(null)
    mockSupabaseFrom({ ordenes_servicio: ordenes, cotizaciones, orden_eventos: eventos })

    const res = await POST(createPostRequest({}), createParams("tok"))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(eventos.insert).not.toHaveBeenCalled()
    expect(queueNotification).not.toHaveBeenCalled()
  })
})
