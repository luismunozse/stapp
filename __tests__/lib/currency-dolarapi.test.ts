import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { obtenerCotizacionMercado, __resetCacheCotizaciones } from "@/lib/currency/dolarapi.server"

const fetchOriginal = global.fetch
const respuesta = (body: unknown, ok = true) => ({ ok, json: async () => body }) as any
const dato = (venta: unknown) => ({ moneda: "USD", casa: "x", nombre: "x", compra: 1, venta, fechaActualizacion: "2026-11-12T10:00:00.000Z" })

describe("obtenerCotizacionMercado", () => {
  let f: ReturnType<typeof vi.fn>
  beforeEach(() => {
    __resetCacheCotizaciones()
    f = vi.fn().mockResolvedValue(respuesta(dato(1200)))
    global.fetch = f as any
  })
  afterEach(() => {
    global.fetch = fetchOriginal
    vi.useRealTimers()
  })

  it.each([
    ["USD", "OFICIAL", "https://dolarapi.com/v1/dolares/oficial"],
    ["USD", "BLUE", "https://dolarapi.com/v1/dolares/blue"],
    ["USD", "MEP", "https://dolarapi.com/v1/dolares/bolsa"],
    ["EUR", "OFICIAL", "https://dolarapi.com/v1/cotizaciones/eur"],
  ] as const)("%s %s -> %s", async (m, fu, url) => {
    await obtenerCotizacionMercado(m, fu)
    expect(f.mock.calls[0][0]).toBe(url)
  })

  it("usa venta y fechaActualizacion", async () => {
    expect(await obtenerCotizacionMercado("USD", "BLUE")).toEqual({ valor: 1200, en: "2026-11-12T10:00:00.000Z" })
  })

  it("cachea 5 minutos", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-11-12T10:00:00Z"))
    await obtenerCotizacionMercado("USD", "BLUE")
    vi.advanceTimersByTime(4 * 60_000)
    await obtenerCotizacionMercado("USD", "BLUE")
    expect(f).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_000 + 1)
    await obtenerCotizacionMercado("USD", "BLUE")
    expect(f).toHaveBeenCalledTimes(2)
  })

  it("claves de caché distintas no se mezclan", async () => {
    await obtenerCotizacionMercado("USD", "BLUE")
    await obtenerCotizacionMercado("USD", "OFICIAL")
    await obtenerCotizacionMercado("EUR", "OFICIAL")
    expect(f).toHaveBeenCalledTimes(3)
  })

  it.each([
    ["ok:false", () => respuesta(dato(1200), false)],
    ["venta 0", () => respuesta(dato(0))],
    ["venta null", () => respuesta(dato(null))],
    ["venta abc", () => respuesta(dato("abc"))],
    ["JSON roto", () => ({ ok: true, json: async () => { throw new SyntaxError("x") } })],
  ])("%s -> null y no se cachea", async (_n, mk) => {
    f.mockResolvedValueOnce(mk())
    expect(await obtenerCotizacionMercado("USD", "BLUE")).toBeNull()
    expect(await obtenerCotizacionMercado("USD", "BLUE")).toEqual({ valor: 1200, en: "2026-11-12T10:00:00.000Z" })
    expect(f).toHaveBeenCalledTimes(2)
  })

  it("un throw -> null y no se cachea", async () => {
    f.mockRejectedValueOnce(new Error("red"))
    expect(await obtenerCotizacionMercado("USD", "BLUE")).toBeNull()
    expect(await obtenerCotizacionMercado("USD", "BLUE")).not.toBeNull()
    expect(f).toHaveBeenCalledTimes(2)
  })
})
