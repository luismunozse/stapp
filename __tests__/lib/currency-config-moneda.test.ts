import { describe, it, expect } from "vitest"
import { resolverConfigMoneda, fuentesPara } from "@/lib/currency/config-moneda"

describe("resolverConfigMoneda", () => {
  it("AR with no row: BLUE suggested, rounding 10, feature off, all sources offered", () => {
    const c = resolverConfigMoneda(null, "AR")
    expect(c).toMatchObject({
      habilitada: false,
      fuente: "BLUE",
      redondeoConversion: 10,
      aceptaUsdEfectivo: false,
      vueltoMonedaDefault: "LOCAL",
      monedaLocal: "ARS",
    })
    expect(c.fuentesDisponibles).toEqual(["MANUAL", "OFICIAL", "BLUE", "MEP"])
  })

  it("AR with a stored row keeps what was stored (a stored 0 is a choice, not a missing value)", () => {
    const c = resolverConfigMoneda(
      { multimoneda_habilitada: true, tipo_cambio_fuente: "MEP", redondeo_conversion: 0, tipo_cambio_manual: 1300 },
      "AR"
    )
    expect(c).toMatchObject({ habilitada: true, fuente: "MEP", redondeoConversion: 0, tipoCambioManual: 1300 })
  })

  it("S1.d: a CLP org only offers MANUAL and rounds to whole pesos (0-decimal currency)", () => {
    const c = resolverConfigMoneda({ multimoneda_habilitada: true, tipo_cambio_fuente: "BLUE" }, "CL")
    expect(c.fuentesDisponibles).toEqual(["MANUAL"])
    expect(c.fuente).toBe("MANUAL")
    expect(c.redondeoConversion).toBe(1)
    expect(c.monedaLocal).toBe("CLP")
    expect(c.habilitada).toBe(true)
  })

  it("AR with no row: foreign currency is USD", () => {
    expect(resolverConfigMoneda(null, "AR").monedaExtranjera).toBe("USD")
  })

  it("AR with EUR: only MANUAL and OFICIAL; a stored BLUE falls back to OFICIAL", () => {
    const c = resolverConfigMoneda({ moneda_extranjera: "EUR", tipo_cambio_fuente: "BLUE" }, "AR")
    expect(c.monedaExtranjera).toBe("EUR")
    expect(c.fuentesDisponibles).toEqual(["MANUAL", "OFICIAL"])
    expect(c.fuente).toBe("OFICIAL")
  })

  it("AR with EUR and no stored source defaults to OFICIAL", () => {
    expect(resolverConfigMoneda({ moneda_extranjera: "EUR" }, "AR").fuente).toBe("OFICIAL")
  })

  it("a USD-local org defaults its foreign currency to EUR", () => {
    const c = resolverConfigMoneda(null, "EC", "USD")
    expect(c.monedaExtranjera).toBe("EUR")
    expect(c.habilitada).toBe(false)
  })

  it("a USD-local org can enable EUR", () => {
    const c = resolverConfigMoneda({ multimoneda_habilitada: true, moneda_extranjera: "EUR" }, "EC", "USD")
    expect(c.habilitada).toBe(true)
    expect(c.monedaExtranjera).toBe("EUR")
  })

  it("local === foreign (USD/USD) keeps the feature off whatever the row says", () => {
    const c = resolverConfigMoneda(
      { multimoneda_habilitada: true, moneda_extranjera: "USD", acepta_usd_efectivo: true, vuelto_moneda_default: "USD" },
      "EC",
      "USD"
    )
    expect(c.habilitada).toBe(false)
    expect(c.aceptaUsdEfectivo).toBe(false)
    expect(c.vueltoMonedaDefault).toBe("LOCAL")
  })

  it("a garbage moneda_extranjera is ignored and the default is used", () => {
    expect(resolverConfigMoneda({ moneda_extranjera: "BRL" }, "AR").monedaExtranjera).toBe("USD")
    expect(resolverConfigMoneda({ moneda_extranjera: "BRL" }, "EC", "USD").monedaExtranjera).toBe("EUR")
  })

  it("fuentesPara: AR+USD, AR+EUR, other country", () => {
    expect(fuentesPara("AR", "USD")).toEqual(["MANUAL", "OFICIAL", "BLUE", "MEP"])
    expect(fuentesPara("AR", "EUR")).toEqual(["MANUAL", "OFICIAL"])
    expect(fuentesPara("CL", "EUR")).toEqual(["MANUAL"])
    expect(fuentesPara(undefined, "USD")).toEqual(["MANUAL"])
  })

  it("USD cash and USD change only count while the feature is on", () => {
    const apagada = resolverConfigMoneda({ acepta_usd_efectivo: true, vuelto_moneda_default: "USD" }, "AR")
    expect(apagada.aceptaUsdEfectivo).toBe(false)
    expect(apagada.vueltoMonedaDefault).toBe("LOCAL")
    const prendida = resolverConfigMoneda(
      { multimoneda_habilitada: true, acepta_usd_efectivo: true, vuelto_moneda_default: "USD" },
      "AR"
    )
    expect(prendida.aceptaUsdEfectivo).toBe(true)
    expect(prendida.vueltoMonedaDefault).toBe("USD")
  })

  it("an explicit local currency wins over the country default", () => {
    expect(resolverConfigMoneda(null, "AR", "EUR").monedaLocal).toBe("EUR")
  })

  it("exposes the reference rate and its date for the fallback chain", () => {
    const c = resolverConfigMoneda(
      { tipo_cambio_referencia: 1250, referencia_en: "2026-10-01T12:00:00Z" },
      "AR"
    )
    expect(c.tipoCambioReferencia).toBe(1250)
    expect(c.referenciaEn).toBe("2026-10-01T12:00:00Z")
  })

  it("unknown country falls back to the generic (non-AR) behaviour", () => {
    const c = resolverConfigMoneda(null, undefined)
    expect(c.fuentesDisponibles).toEqual(["MANUAL"])
    expect(c.redondeoConversion).toBe(0)
  })

  it("a stored rounding choice is kept even for a 0-decimal currency", () => {
    expect(resolverConfigMoneda({ redondeo_conversion: 100 }, "CL").redondeoConversion).toBe(100)
  })

  it("an inherited Object.prototype key is not a currency code", () => {
    const c = resolverConfigMoneda(null, "CL", "constructor")
    expect(c.monedaLocal).toBe("CLP")
    expect(resolverConfigMoneda(null, "CL", "toString").monedaLocal).toBe("CLP")
  })
})
