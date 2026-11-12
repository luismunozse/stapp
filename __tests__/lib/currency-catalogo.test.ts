import { describe, it, expect } from "vitest"
import { resolverConfigMoneda, type ConfigMoneda } from "@/lib/currency/config-moneda"
import type { ResultadoTipoCambio } from "@/lib/currency/tipo-cambio"
import {
  validarMonedaEscritura,
  cotizacionDe,
  precioALocal,
  convertirPrecioCatalogo,
  etiquetaFuente,
  costoKitLocal,
  valorLocalStock,
} from "@/lib/currency/catalogo"

const base = resolverConfigMoneda({ multimoneda_habilitada: true, moneda_extranjera: "USD", redondeo_conversion: 10 }, "AR")
const config: ConfigMoneda = { ...base, habilitada: true, monedaExtranjera: "USD", redondeoConversion: 10 }
const configEUR: ConfigMoneda = { ...config, monedaExtranjera: "EUR" }
const apagada: ConfigMoneda = { ...config, habilitada: false }
const en = "2026-11-12T10:00:00.000Z"
const tc: ResultadoTipoCambio = { disponible: true, valor: 1200, fuente: "BLUE", moneda: "USD", en, estado: "vivo" }
const tcEUR: ResultadoTipoCambio = { disponible: true, valor: 1400, fuente: "OFICIAL", moneda: "EUR", en, estado: "vivo" }
const sinTc: ResultadoTipoCambio = { disponible: false, motivo: "SIN_COTIZACION" }

describe("validarMonedaEscritura", () => {
  it("undefined keeps the current currency (or null)", () => {
    expect(validarMonedaEscritura(undefined, undefined, config)).toEqual({ ok: true, moneda: null })
    expect(validarMonedaEscritura(undefined, "USD", config)).toEqual({ ok: true, moneda: "USD" })
  })
  it("accepts the org foreign currency, rejects others", () => {
    expect(validarMonedaEscritura("USD", undefined, config)).toEqual({ ok: true, moneda: "USD" })
    const eur = validarMonedaEscritura("EUR", undefined, config)
    expect(eur.ok).toBe(false)
    if (!eur.ok) expect(eur.error).toContain("moneda local o USD")
    expect(validarMonedaEscritura("ARS", undefined, config).ok).toBe(false)
  })
  it("null is always ok", () => {
    expect(validarMonedaEscritura(null, "USD", apagada)).toEqual({ ok: true, moneda: null })
  })
  it("feature off: new foreign currency rejected, unchanged one kept", () => {
    expect(validarMonedaEscritura("USD", undefined, apagada)).toEqual({
      ok: false,
      error: "La moneda extranjera está deshabilitada",
    })
    expect(validarMonedaEscritura("USD", "USD", apagada)).toEqual({ ok: true, moneda: "USD" })
  })
  it("keeps the current currency even if the org foreign currency changed", () => {
    expect(validarMonedaEscritura("USD", "USD", configEUR)).toEqual({ ok: true, moneda: "USD" })
  })
})

describe("cotizacionDe", () => {
  it("local is 1; foreign needs matching currency and a rate", () => {
    expect(cotizacionDe(null, config, null)).toBe(1)
    expect(cotizacionDe("USD", config, tc)).toBe(1200)
    expect(cotizacionDe("USD", config, sinTc)).toBeNull()
    expect(cotizacionDe("USD", config, null)).toBeNull()
    expect(cotizacionDe("USD", configEUR, tcEUR)).toBeNull()
  })
})

describe("precioALocal", () => {
  it("converts and rounds to the conversion unit", () => {
    expect(precioALocal(50, "USD", config, tc)).toBe(60000)
    expect(precioALocal(49.99, "USD", config, tc)).toBe(59990)
    expect(precioALocal(0, "USD", config, tc)).toBe(0)
  })
  it("returns null when there is no equivalent", () => {
    expect(precioALocal(50, "USD", configEUR, tcEUR)).toBeNull()
    expect(precioALocal(50, "USD", config, sinTc)).toBeNull()
    expect(precioALocal(-1, "USD", config, tc)).toBeNull()
    expect(precioALocal(null, "USD", config, tc)).toBeNull()
    expect(precioALocal(NaN, null, config, tc)).toBeNull()
  })
  it("local price passes through", () => {
    expect(precioALocal(500, null, config, tc)).toBe(500)
  })
})

describe("convertirPrecioCatalogo", () => {
  it("converts between currencies", () => {
    expect(convertirPrecioCatalogo(60000, null, "USD", 1200, 10)).toBe(50)
    expect(convertirPrecioCatalogo(50, "USD", null, 1200, 10)).toBe(60000)
    expect(convertirPrecioCatalogo(10, null, "USD", 3, 0)).toBe(3.33)
    expect(convertirPrecioCatalogo(7, "USD", "USD", 1200, 10)).toBe(7)
    expect(convertirPrecioCatalogo(7, null, null, 1200, 10)).toBe(7)
  })
})

describe("etiquetaFuente", () => {
  it("labels", () => {
    expect(etiquetaFuente("MANUAL")).toBe("Manual")
    expect(etiquetaFuente("OFICIAL")).toBe("Oficial")
    expect(etiquetaFuente("BLUE")).toBe("Blue")
    expect(etiquetaFuente("MEP")).toBe("MEP")
  })
})

describe("costoKitLocal", () => {
  it("sums components in local currency", () => {
    expect(
      costoKitLocal(
        [
          { cantidad: 2, precioCompra: 10, moneda: "USD" },
          { cantidad: 1, precioCompra: 500, moneda: null },
        ],
        config,
        tc
      )
    ).toBe(24500)
  })
  it("null precioCompra counts as 0", () => {
    expect(costoKitLocal([{ cantidad: 3, precioCompra: null, moneda: "USD" }], config, tc)).toBe(0)
  })
  it("null when a component has no equivalent", () => {
    expect(
      costoKitLocal(
        [
          { cantidad: 1, precioCompra: 10, moneda: "EUR" },
          { cantidad: 1, precioCompra: 500, moneda: null },
        ],
        config,
        tc
      )
    ).toBeNull()
  })
})

describe("valorLocalStock", () => {
  type It = { moneda: "USD" | "EUR" | null; monto: number }
  const m = (i: It) => i.monto
  it("sums local, converts foreign, excludes unconvertible", () => {
    const r = valorLocalStock<It>(
      [
        { moneda: null, monto: 1000 },
        { moneda: "USD", monto: 10 },
        { moneda: "EUR", monto: 5 },
      ],
      m,
      config,
      tc
    )
    expect(r).toEqual({ total: 13000, excluidos: 1, convertido: true })
  })
  it("only local items: not converted", () => {
    const r = valorLocalStock<It>([{ moneda: null, monto: 1000 }, { moneda: null, monto: 250.5 }], m, config, null)
    expect(r).toEqual({ total: 1250.5, excluidos: 0, convertido: false })
  })
})
