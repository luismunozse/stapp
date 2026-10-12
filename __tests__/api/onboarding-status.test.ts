import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"
import { GET } from "@/app/api/onboarding/status/route"

describe("GET /api/onboarding/status", () => {
  beforeEach(() => vi.clearAllMocks())

  it("ignores the practice order and the practice client", async () => {
    mockAuthSuccess()
    const clientes = createChainMock(null, null, 0)
    const ordenes = createChainMock(null, null, 0)
    mockSupabaseFrom({
      clientes,
      inventario: createChainMock(null, null, 0),
      ordenes_servicio: ordenes,
      organizations: createChainMock({ logo_url: null }),
    })

    const { status, body } = await parseResponse(await GET())

    expect(status).toBe(200)
    expect(ordenes.eq).toHaveBeenCalledWith("es_practica", false)
    expect(clientes.eq).toHaveBeenCalledWith("es_practica", false)
    expect(body.hasFirstOrder).toBe(false)
    expect(body.hasClients).toBe(false)
  })
})
