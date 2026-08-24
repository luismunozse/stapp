import { describe, it, expect } from "vitest"
import { COUNTRIES, getCountryConfig, getIvaGeneral } from "@/lib/countries"

describe("countries — tasa general de IVA por pais", () => {
  it("Chile usa 19%, no la tasa argentina", () => {
    expect(getIvaGeneral("CL")).toBe(19)
  })

  it("Argentina usa 21%, no la tasa especial de 27%", () => {
    expect(getIvaGeneral("AR")).toBe(21)
  })

  it("cae en Argentina cuando el pais es desconocido o falta", () => {
    expect(getIvaGeneral(null)).toBe(21)
    expect(getIvaGeneral("XX")).toBe(21)
  })

  it("la tasa general de cada pais es una de sus alicuotas ofrecidas", () => {
    for (const country of Object.values(COUNTRIES)) {
      expect(country.ivaOptions).toContain(country.ivaGeneral)
    }
  })

  it("los paises sin IVA declaran tasa general 0", () => {
    for (const country of Object.values(COUNTRIES)) {
      if (country.ivaOptions.every((o) => o === 0)) {
        expect(country.ivaGeneral).toBe(0)
      }
    }
  })

  it("getCountryConfig expone la tasa general junto al resto de la config", () => {
    expect(getCountryConfig("CL").ivaGeneral).toBe(19)
  })
})
