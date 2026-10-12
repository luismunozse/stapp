import { describe, it, expect, beforeEach, vi } from "vitest"
import { createChainMock, mockSupabaseFrom, mockAuthSuccess, createGetRequest, parseResponse } from "./helpers"

describe("GET /api/notificaciones", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockAuthSuccess({ organizationId: "org-1" })
  })

  it("devuelve el estado de entrega en el historial", async () => {
    const logs = createChainMock([
      {
        id: "log-1",
        tipo: "CAMBIO_ESTADO",
        canal: "EMAIL",
        estado: "ENVIADO",
        estado_entrega: "REBOTADO",
        bounce_tipo: "HARD",
        bounced_at: "2026-08-31T12:00:00.000Z",
        delivered_at: null,
      },
    ])
    mockSupabaseFrom({ notification_logs: logs })

    const { GET } = await import("@/app/api/notificaciones/route")
    const { status, body } = await parseResponse(
      await GET(createGetRequest("http://localhost:3000/api/notificaciones"))
    )

    expect(status).toBe(200)
    expect(body[0].estado_entrega).toBe("REBOTADO")
    expect(body[0].bounce_tipo).toBe("HARD")

    const selectArg = vi.mocked(logs.select).mock.calls[0][0] as string
    expect(selectArg).toContain("estado_entrega")
    expect(selectArg).toContain("bounce_tipo")
  })
})
