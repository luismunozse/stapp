import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockAuthError, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

import { hasPlanFeature } from "@/lib/subscriptions"
import { POST as crearCotizacion } from "@/app/api/cotizaciones/route"

describe("gating de cotizaciones_online — POST /api/cotizaciones", () => {
  beforeEach(() => vi.clearAllMocks())

  it("401 si no está autenticado", async () => {
    mockAuthError()
    const res = await crearCotizacion(createPostRequest({}))
    const { status } = await parseResponse(res)
    expect(status).toBe(401)
  })

  it("403 FEATURE_REQUIRED cuando el plan no tiene cotizaciones_online", async () => {
    mockAuthSuccess()
    vi.mocked(hasPlanFeature).mockResolvedValueOnce(false)
    const res = await crearCotizacion(createPostRequest({ items: [] }))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(403)
    expect(body.code).toBe("FEATURE_REQUIRED")
    expect(body.feature).toBe("cotizaciones_online")
  })

  it("pasa el gate (no 403) cuando el plan tiene la feature", async () => {
    mockAuthSuccess()
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    const res = await crearCotizacion(createPostRequest({ items: [] }))
    const { status } = await parseResponse(res)
    expect(status).not.toBe(403)
  })
})
