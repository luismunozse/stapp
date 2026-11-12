import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mockAuthSuccess, mockAuthError, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"

vi.mock("@/lib/currency/dolarapi.server", () => ({
  obtenerCotizacionMercado: vi.fn(),
}))

import { obtenerCotizacionMercado } from "@/lib/currency/dolarapi.server"
import { GET } from "@/app/api/moneda/tipo-cambio/route"

const org = { pais: "AR", moneda: "ARS" }
const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString()

function fila(extra: Record<string, unknown> = {}) {
  return {
    multimoneda_habilitada: true,
    moneda_extranjera: "USD",
    tipo_cambio_fuente: "BLUE",
    tipo_cambio_manual: null,
    tipo_cambio_referencia: null,
    referencia_en: null,
    updated_at: hace(600),
    ...extra,
  }
}

describe("GET /api/moneda/tipo-cambio", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("sin sesión responde 401", async () => {
    mockAuthError()
    const { status } = await parseResponse(await GET())
    expect(status).toBe(401)
  })

  it.each(["VENDEDOR", "TECNICO"])("un %s recibe 200 con la cotización MANUAL", async (role) => {
    mockAuthSuccess({ role })
    mockSupabaseFrom({
      organizations: createChainMock(org),
      organizacion_moneda: createChainMock(fila({ tipo_cambio_fuente: "MANUAL", tipo_cambio_manual: 1300 })),
    })
    const res = await GET()
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body).toMatchObject({ disponible: true, fuente: "MANUAL", valor: 1300 })
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=60")
    expect(obtenerCotizacionMercado).not.toHaveBeenCalled()
  })

  it("BLUE con fuente viva: estado vivo y guarda la referencia", async () => {
    mockAuthSuccess()
    const en = new Date().toISOString()
    vi.mocked(obtenerCotizacionMercado).mockResolvedValue({ valor: 1200, en })
    const moneda = createChainMock(fila())
    mockSupabaseFrom({ organizations: createChainMock(org), organizacion_moneda: moneda })
    const { status, body } = await parseResponse(await GET())
    expect(status).toBe(200)
    expect(body).toMatchObject({ disponible: true, estado: "vivo", valor: 1200 })
    expect(obtenerCotizacionMercado).toHaveBeenCalledWith("USD", "BLUE")
    expect(moneda.update).toHaveBeenCalledWith(
      expect.objectContaining({ tipo_cambio_referencia: 1200, referencia_en: expect.any(String) })
    )
    expect(moneda.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("no reescribe la referencia si es igual y reciente", async () => {
    mockAuthSuccess()
    vi.mocked(obtenerCotizacionMercado).mockResolvedValue({ valor: 1200, en: new Date().toISOString() })
    const moneda = createChainMock(fila({ tipo_cambio_referencia: 1200, referencia_en: hace(1) }))
    mockSupabaseFrom({ organizations: createChainMock(org), organizacion_moneda: moneda })
    const { status } = await parseResponse(await GET())
    expect(status).toBe(200)
    expect(moneda.update).not.toHaveBeenCalled()
  })

  it("fuente caída con referencia reciente: estado referencia, sin update", async () => {
    mockAuthSuccess()
    vi.mocked(obtenerCotizacionMercado).mockResolvedValue(null)
    const moneda = createChainMock(fila({ tipo_cambio_referencia: 1150, referencia_en: hace(60) }))
    mockSupabaseFrom({ organizations: createChainMock(org), organizacion_moneda: moneda })
    const { status, body } = await parseResponse(await GET())
    expect(status).toBe(200)
    expect(body).toMatchObject({ disponible: true, estado: "referencia", valor: 1150 })
    expect(moneda.update).not.toHaveBeenCalled()
  })

  it.each(["42P01", "42703"])("organizacion_moneda con error %s: DESHABILITADA con 200", async (code) => {
    mockAuthSuccess()
    mockSupabaseFrom({
      organizations: createChainMock(org),
      organizacion_moneda: createChainMock(null, { code, message: "x" }),
    })
    const { status, body } = await parseResponse(await GET())
    expect(status).toBe(200)
    expect(body).toEqual({ disponible: false, motivo: "DESHABILITADA" })
  })

  it("si falla el update de la referencia igual responde 200 con el valor vivo", async () => {
    mockAuthSuccess()
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(obtenerCotizacionMercado).mockResolvedValue({ valor: 1200, en: new Date().toISOString() })
    const moneda = createChainMock(fila())
    moneda.update.mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
    })
    mockSupabaseFrom({ organizations: createChainMock(org), organizacion_moneda: moneda })
    const { status, body } = await parseResponse(await GET())
    expect(status).toBe(200)
    expect(body).toMatchObject({ estado: "vivo", valor: 1200 })
    expect(spy).toHaveBeenCalled()
  })

  describe("escritura de la referencia", () => {
    const AHORA = new Date("2026-11-12T12:00:00.000Z")
    const haceDesdeAhora = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString()
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(AHORA)
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it("valor igual, referencia de hace 2 min y cotización de hace 6 h: no actualiza", async () => {
      mockAuthSuccess()
      vi.mocked(obtenerCotizacionMercado).mockResolvedValue({ valor: 1200, en: haceDesdeAhora(360) })
      const moneda = createChainMock(fila({ tipo_cambio_referencia: 1200, referencia_en: haceDesdeAhora(2) }))
      mockSupabaseFrom({ organizations: createChainMock(org), organizacion_moneda: moneda })
      const { status } = await parseResponse(await GET())
      expect(status).toBe(200)
      expect(moneda.update).not.toHaveBeenCalled()
    })

    it("valor igual y referencia de hace 6 min: actualiza con la hora de consulta, no la del mercado", async () => {
      mockAuthSuccess()
      vi.mocked(obtenerCotizacionMercado).mockResolvedValue({ valor: 1200, en: haceDesdeAhora(360) })
      const moneda = createChainMock(fila({ tipo_cambio_referencia: 1200, referencia_en: haceDesdeAhora(6) }))
      mockSupabaseFrom({ organizations: createChainMock(org), organizacion_moneda: moneda })
      const { body } = await parseResponse(await GET())
      expect(moneda.update).toHaveBeenCalledWith({
        tipo_cambio_referencia: 1200,
        referencia_en: AHORA.toISOString(),
      })
      expect(body.en).toBe(haceDesdeAhora(360))
    })
  })

  it("error de lectura de organizations (no PGRST116): 500", async () => {
    mockAuthSuccess()
    vi.spyOn(console, "error").mockImplementation(() => {})
    mockSupabaseFrom({
      organizations: createChainMock(null, { code: "XX000", message: "boom" }),
      organizacion_moneda: createChainMock(fila()),
    })
    const { status, body } = await parseResponse(await GET())
    expect(status).toBe(500)
    expect(body).toEqual({ error: "Error al obtener la cotización" })
  })

  it("excepción inesperada: 500", async () => {
    mockAuthSuccess()
    vi.spyOn(console, "error").mockImplementation(() => {})
    mockSupabaseFrom({
      organizations: createChainMock(org),
      organizacion_moneda: createChainMock(fila()),
    })
    vi.mocked(obtenerCotizacionMercado).mockRejectedValue(new Error("x"))
    const { status, body } = await parseResponse(await GET())
    expect(status).toBe(500)
    expect(body).toEqual({ error: "Error al obtener la cotización" })
  })
})
