import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

import { POST } from "@/app/api/public/cotizaciones/[token]/rechazar/route"

function createParams(token: string) {
  return { params: Promise.resolve({ token }) }
}

const VALID_TOKEN = "a".repeat(32)

const mockCotizacion = {
  id: "cot-1",
  estado: "ENVIADA",
  orden_id: "ord-1",
  organization_id: "org-1",
}

describe("POST /api/public/cotizaciones/[token]/rechazar", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 400 when token is not 32 chars", async () => {
    const response = await POST(createPostRequest({}), createParams("short-token"))
    const { status } = await parseResponse(response)
    expect(status).toBe(400)
  })

  it("returns 404 when cotizacion is not found", async () => {
    mockSupabaseFrom({
      cotizaciones: createChainMock(null, { message: "not found" }),
    })

    const response = await POST(createPostRequest({}), createParams(VALID_TOKEN))
    const { status } = await parseResponse(response)
    expect(status).toBe(404)
  })

  it("returns 400 when cotizacion is not in ENVIADA state", async () => {
    mockSupabaseFrom({
      cotizaciones: createChainMock({ ...mockCotizacion, estado: "ACEPTADA" }),
    })

    const response = await POST(createPostRequest({}), createParams(VALID_TOKEN))
    const { status } = await parseResponse(response)
    expect(status).toBe(400)
  })

  it("does not revert the orden or insert an event when the orden is not in PRESUPUESTADO", async () => {
    const cotizacionChain = createChainMock(mockCotizacion)
    const cotizacionUpdateChain = createChainMock(null)
    cotizacionUpdateChain.then = (resolve: any) => resolve({ data: null, error: null })
    cotizacionChain.update = vi.fn().mockReturnValue(cotizacionUpdateChain)

    const ordenChain = createChainMock({ id: "ord-1", estado: "EN_REPARACION" })
    const eventosChain = createChainMock(null)
    const insertSpy = vi.fn().mockReturnValue(eventosChain)
    eventosChain.insert = insertSpy
    const ordenUpdateSpy = vi.fn().mockReturnValue(createChainMock(null))

    mockSupabaseFrom({
      cotizaciones: cotizacionChain,
      ordenes_servicio: { ...ordenChain, update: ordenUpdateSpy } as any,
      orden_eventos: eventosChain,
    })

    const response = await POST(createPostRequest({}), createParams(VALID_TOKEN))
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(ordenUpdateSpy).not.toHaveBeenCalled()
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it("reverts the orden to EN_DIAGNOSTICO and inserts a PRESUPUESTO_RECHAZADO event when orden is PRESUPUESTADO", async () => {
    const cotizacionChain = createChainMock(mockCotizacion)
    const cotizacionUpdateChain = createChainMock(null)
    cotizacionUpdateChain.then = (resolve: any) => resolve({ data: null, error: null })
    cotizacionChain.update = vi.fn().mockReturnValue(cotizacionUpdateChain)

    const ordenChain = createChainMock({ id: "ord-1", estado: "PRESUPUESTADO" })
    const ordenUpdateChain = createChainMock(null)
    ordenUpdateChain.then = (resolve: any) => resolve({ data: null, error: null })
    const ordenUpdateSpy = vi.fn().mockReturnValue(ordenUpdateChain)

    const eventosChain = createChainMock(null)
    eventosChain.then = (resolve: any) => resolve({ data: null, error: null })
    const insertSpy = vi.fn().mockReturnValue(eventosChain)
    eventosChain.insert = insertSpy

    mockSupabaseFrom({
      cotizaciones: cotizacionChain,
      ordenes_servicio: { ...ordenChain, update: ordenUpdateSpy } as any,
      orden_eventos: eventosChain,
    })

    const response = await POST(
      createPostRequest({ motivo: "Muy caro" }),
      createParams(VALID_TOKEN)
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(ordenUpdateSpy).toHaveBeenCalledWith({ estado: "EN_DIAGNOSTICO" })
    expect(insertSpy).toHaveBeenCalledTimes(1)

    const payload = insertSpy.mock.calls[0][0]
    expect(payload.orden_id).toBe("ord-1")
    expect(payload.organization_id).toBe("org-1")
    expect(payload.tipo).toBe("PRESUPUESTO_RECHAZADO")
    expect(payload.estado_anterior).toBe("PRESUPUESTADO")
    expect(payload.estado_nuevo).toBe("EN_DIAGNOSTICO")
    expect(payload.descripcion).toContain("Muy caro")
  })
})
