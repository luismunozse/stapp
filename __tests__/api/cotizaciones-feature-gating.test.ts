import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockAuthError, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

import { hasPlanFeature } from "@/lib/subscriptions"
import { POST as crearCotizacion } from "@/app/api/cotizaciones/route"
import { PUT as editarCotizacion } from "@/app/api/cotizaciones/[id]/route"
import { POST as enviarCotizacion } from "@/app/api/cotizaciones/[id]/enviar/route"
import { POST as duplicarCotizacion } from "@/app/api/cotizaciones/[id]/duplicar/route"
import { POST as crearTemplate } from "@/app/api/cotizacion-templates/route"

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

const params = { params: Promise.resolve({ id: "cot-1" }) }

describe("gating — rutas de escritura restantes", () => {
  beforeEach(() => vi.clearAllMocks())

  it("PUT [id] → 403 sin feature", async () => {
    mockAuthSuccess()
    vi.mocked(hasPlanFeature).mockResolvedValueOnce(false)
    const res = await editarCotizacion(createPostRequest({ estado: "ENVIADA" }), params)
    const { status, body } = await parseResponse(res)
    expect(status).toBe(403)
    expect(body.feature).toBe("cotizaciones_online")
  })

  it("enviar → 403 sin feature", async () => {
    mockAuthSuccess()
    vi.mocked(hasPlanFeature).mockResolvedValueOnce(false)
    const res = await enviarCotizacion(createPostRequest({}), params)
    const { status } = await parseResponse(res)
    expect(status).toBe(403)
  })

  it("duplicar → 403 sin feature", async () => {
    mockAuthSuccess()
    vi.mocked(hasPlanFeature).mockResolvedValueOnce(false)
    const res = await duplicarCotizacion(createPostRequest({}), params)
    const { status } = await parseResponse(res)
    expect(status).toBe(403)
  })

  it("crear template → 403 sin feature", async () => {
    mockAuthSuccess()
    vi.mocked(hasPlanFeature).mockResolvedValueOnce(false)
    const res = await crearTemplate(createPostRequest({ nombre: "x", items: [] }))
    const { status } = await parseResponse(res)
    expect(status).toBe(403)
  })
})
