import { describe, it, expect } from "vitest"
import { validarInforme, esInforme } from "@/lib/cotizacion-informe"

const DICTAMEN_COMPLETO = {
  veredicto: "IRREPARABLE",
  diagnosticoTecnico: "Placa madre con corrosion por liquido, sin reparacion posible.",
  causaDano: "LIQUIDO",
}

describe("validarInforme", () => {
  it("acepta una cotizacion con items aunque no tenga veredicto", () => {
    expect(validarInforme({ cantidadItems: 3 })).toBeNull()
  })

  it("acepta una cotizacion con items y veredicto REPARABLE", () => {
    expect(
      validarInforme({ cantidadItems: 1, veredicto: "REPARABLE", diagnosticoTecnico: "Pantalla rota" })
    ).toBeNull()
  })

  it("acepta cero items cuando el dictamen esta completo", () => {
    expect(validarInforme({ cantidadItems: 0, ...DICTAMEN_COMPLETO })).toBeNull()
  })

  it("acepta cero items con veredicto SIN_FALLA", () => {
    expect(
      validarInforme({ ...DICTAMEN_COMPLETO, cantidadItems: 0, veredicto: "SIN_FALLA" })
    ).toBeNull()
  })

  it("rechaza cero items sin veredicto", () => {
    const msg = validarInforme({ cantidadItems: 0 })
    expect(msg).toContain("veredicto")
  })

  it("rechaza cero items con veredicto REPARABLE", () => {
    const msg = validarInforme({ ...DICTAMEN_COMPLETO, cantidadItems: 0, veredicto: "REPARABLE" })
    expect(msg).toContain("al menos un ítem")
  })

  it("rechaza cero items sin diagnostico", () => {
    const msg = validarInforme({ ...DICTAMEN_COMPLETO, cantidadItems: 0, diagnosticoTecnico: null })
    expect(msg).toContain("diagnóstico")
  })

  it("rechaza un diagnostico que es solo espacios", () => {
    const msg = validarInforme({ ...DICTAMEN_COMPLETO, cantidadItems: 0, diagnosticoTecnico: "   " })
    expect(msg).toContain("diagnóstico")
  })

  it("rechaza cero items sin causa del dano", () => {
    const msg = validarInforme({ ...DICTAMEN_COMPLETO, cantidadItems: 0, causaDano: null })
    expect(msg).toContain("causa")
  })
})

describe("esInforme", () => {
  it("es informe cuando no hay items y el veredicto no admite presupuesto", () => {
    expect(esInforme({ cantidadItems: 0, veredicto: "IRREPARABLE" })).toBe(true)
    expect(esInforme({ cantidadItems: 0, veredicto: "SIN_FALLA" })).toBe(true)
  })

  it("no es informe si hay items, aunque el veredicto sea IRREPARABLE", () => {
    expect(esInforme({ cantidadItems: 2, veredicto: "IRREPARABLE" })).toBe(false)
  })

  it("no es informe sin veredicto ni con veredicto REPARABLE", () => {
    expect(esInforme({ cantidadItems: 0 })).toBe(false)
    expect(esInforme({ cantidadItems: 0, veredicto: "REPARABLE" })).toBe(false)
  })
})
