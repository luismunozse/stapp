import { describe, it, expect } from "vitest"
import { resolverConfigMoneda } from "@/lib/currency/config-moneda"

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

  it("S1.d: a CLP org only offers MANUAL and rounds to nothing", () => {
    const c = resolverConfigMoneda({ multimoneda_habilitada: true, tipo_cambio_fuente: "BLUE" }, "CL")
    expect(c.fuentesDisponibles).toEqual(["MANUAL"])
    expect(c.fuente).toBe("MANUAL")
    expect(c.redondeoConversion).toBe(0)
    expect(c.monedaLocal).toBe("CLP")
    expect(c.habilitada).toBe(true)
  })

  it("S1.e: a USD-local org has the feature off whatever the row says", () => {
    const c = resolverConfigMoneda(
      { multimoneda_habilitada: true, acepta_usd_efectivo: true, vuelto_moneda_default: "USD" },
      "EC",
      "USD"
    )
    expect(c.habilitada).toBe(false)
    expect(c.aceptaUsdEfectivo).toBe(false)
    expect(c.vueltoMonedaDefault).toBe("LOCAL")
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
})
