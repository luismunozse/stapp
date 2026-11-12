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
  ])("%j -> %j", (entrada, esperado) => {
    expect(normalizarNumeroAR(entrada)).toBe(esperado)
  })
})
