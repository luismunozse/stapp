import { describe, it, expect } from "vitest"
import { condicionFiscalDeFila, deriveTipo, tipoEmisionDeFila } from "@/lib/facturacion/derive"

describe("deriveTipo", () => {
  it("monotributo emits Factura C", () => {
    expect(deriveTipo("MONOTRIBUTO")).toBe("C")
  })
  it("responsable inscripto emits Factura B", () => {
    expect(deriveTipo("RESPONSABLE_INSCRIPTO")).toBe("B")
  })
})

describe("tipoEmisionDeFila (lo que la ficha anuncia antes de emitir)", () => {
  it("MONOTRIBUTO -> C", () => {
    expect(tipoEmisionDeFila({ condicion_fiscal: "MONOTRIBUTO" })).toBe("C")
  })
  it("RESPONSABLE_INSCRIPTO -> B", () => {
    expect(tipoEmisionDeFila({ condicion_fiscal: "RESPONSABLE_INSCRIPTO" })).toBe("B")
  })
  it("sin condicion guardada se asume Monotributo -> C", () => {
    expect(condicionFiscalDeFila(null)).toBe("MONOTRIBUTO")
    expect(tipoEmisionDeFila({ condicion_fiscal: null })).toBe("C")
    expect(tipoEmisionDeFila({})).toBe("C")
  })
})
