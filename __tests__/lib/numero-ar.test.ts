import { describe, it, expect } from "vitest"
import { normalizarNumeroAR } from "@/lib/currency/numero-ar"

describe("normalizarNumeroAR", () => {
  it.each([
    ["1.250,50", "1250.50"],
    ["1300,5", "1300.5"],
    ["1.250", "1250"],
    ["1.250.000", "1250000"],
    ["1250.5", "1250.5"],
    ["", ""],
    ["  1300,5 ", "1300.5"],
    ["1,250.50", "1250.50"],
    ["1,250,000.5", "1250000.5"],
    ["1.250.000,5", "1250000.5"],
    // Only a comma: it is the decimal separator (AR convention), so "1,250" is 1.25, not 1250.
    ["1,250", "1.250"],
  ])("%j -> %j", (entrada, esperado) => {
    expect(normalizarNumeroAR(entrada)).toBe(esperado)
  })
})
