import { describe, it, expect } from "vitest"
import { parseMoneyInput } from "@/lib/parse-money"

describe("parseMoneyInput — normaliza montos es-AR (coma decimal, punto de miles)", () => {
  it("coma como separador decimal (teclado Android es-AR)", () => {
    expect(parseMoneyInput("1500,50")).toBeCloseTo(1500.5, 2)
  })

  it("punto de miles + coma decimal (formato AR)", () => {
    expect(parseMoneyInput("1.500,50")).toBeCloseTo(1500.5, 2)
    expect(parseMoneyInput("1.234.567,89")).toBeCloseTo(1234567.89, 2)
  })

  it("punto decimal (escritorio) se respeta", () => {
    expect(parseMoneyInput("1500.50")).toBeCloseTo(1500.5, 2)
  })

  it("entero sin separadores", () => {
    expect(parseMoneyInput("1500")).toBe(1500)
    expect(parseMoneyInput("0")).toBe(0)
  })

  it("recorta espacios", () => {
    expect(parseMoneyInput("  1.234,5  ")).toBeCloseTo(1234.5, 2)
  })

  it("string vacío o inválido → NaN", () => {
    expect(parseMoneyInput("")).toBeNaN()
    expect(parseMoneyInput("   ")).toBeNaN()
    expect(parseMoneyInput("abc")).toBeNaN()
  })

  it("null / undefined → NaN", () => {
    expect(parseMoneyInput(null)).toBeNaN()
    expect(parseMoneyInput(undefined)).toBeNaN()
  })

  it("number pasa derecho", () => {
    expect(parseMoneyInput(1500.5)).toBe(1500.5)
    expect(parseMoneyInput(0)).toBe(0)
    expect(parseMoneyInput(NaN)).toBeNaN()
  })

  it("caso del bug: 1500,50 NO se trunca a 1500", () => {
    expect(parseMoneyInput("1500,50")).not.toBe(1500)
  })

  it("caso del bug: 1.500,50 NO colapsa a 1.5", () => {
    expect(parseMoneyInput("1.500,50")).not.toBeCloseTo(1.5, 2)
  })
})
