import { describe, it, expect } from "vitest"
import { decidirTipoCambio, REFERENCIA_MAX_HORAS } from "@/lib/currency/tipo-cambio"
import type { ConfigMoneda } from "@/lib/currency/config-moneda"

const AHORA = new Date("2026-11-12T12:00:00.000Z")
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString()

function cfg(p: Partial<ConfigMoneda> = {}): ConfigMoneda {
  return {
    monedaLocal: "ARS",
    habilitada: true,
    monedaExtranjera: "USD",
    fuentesDisponibles: ["MANUAL", "OFICIAL", "BLUE", "MEP"],
    fuente: "BLUE",
    tipoCambioManual: null,
    tipoCambioReferencia: null,
    referenciaEn: null,
    redondeoConversion: 0,
    aceptaUsdEfectivo: false,
    vueltoMonedaDefault: "LOCAL",
    ...p,
  } as ConfigMoneda
}

describe("decidirTipoCambio", () => {
  it("expone el máximo de horas de la referencia", () => {
    expect(REFERENCIA_MAX_HORAS).toBe(24)
  })

  it("deshabilitada", () => {
    expect(decidirTipoCambio(cfg({ habilitada: false }), { valor: 1, en: "x" }, AHORA)).toEqual({
      disponible: false,
      motivo: "DESHABILITADA",
    })
  })

  it("MANUAL con valor usa manualEn o ahora e ignora vivo", () => {
    const c = cfg({ fuente: "MANUAL", tipoCambioManual: 1250.5 })
    expect(decidirTipoCambio(c, { valor: 999, en: "otro" }, AHORA)).toMatchObject({
      disponible: true, valor: 1250.5, estado: "vivo", fuente: "MANUAL", moneda: "USD", en: AHORA.toISOString(),
    })
    expect(decidirTipoCambio(c, null, AHORA, "2026-01-01T00:00:00.000Z")).toMatchObject({ en: "2026-01-01T00:00:00.000Z" })
  })

  it("MANUAL sin valor", () => {
    expect(decidirTipoCambio(cfg({ fuente: "MANUAL" }), { valor: 5, en: "x" }, AHORA)).toEqual({
      disponible: false, motivo: "SIN_COTIZACION",
    })
  })

  it("BLUE con vivo", () => {
    expect(decidirTipoCambio(cfg(), { valor: 1200, en: "t" }, AHORA)).toEqual({
      disponible: true, valor: 1200, fuente: "BLUE", moneda: "USD", en: "t", estado: "vivo",
    })
  })

  it("sin vivo: referencia de 23h59 vale, de 24h01 no, ausente no, 24h exactas sí", () => {
    const ref = (min: number) => cfg({ tipoCambioReferencia: 1100, referenciaEn: hace(min) })
    expect(decidirTipoCambio(ref(23 * 60 + 59), null, AHORA)).toEqual({
      disponible: true, valor: 1100, fuente: "BLUE", moneda: "USD", en: hace(23 * 60 + 59), estado: "referencia",
    })
    expect(decidirTipoCambio(ref(24 * 60), null, AHORA)).toMatchObject({ estado: "referencia" })
    expect(decidirTipoCambio(ref(24 * 60 + 1), null, AHORA)).toEqual({ disponible: false, motivo: "SIN_COTIZACION" })
    expect(decidirTipoCambio(cfg(), null, AHORA)).toEqual({ disponible: false, motivo: "SIN_COTIZACION" })
    expect(decidirTipoCambio(cfg({ tipoCambioReferencia: 1100, referenciaEn: "basura" }), null, AHORA)).toEqual({
      disponible: false, motivo: "SIN_COTIZACION",
    })
  })
})
