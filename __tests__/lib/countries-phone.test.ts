import { describe, it, expect } from "vitest"
import { formatPhoneForCountry } from "@/lib/countries"

describe("formatPhoneForCountry — prefijo internacional 00", () => {
  it.each([
    ["0034612345678", "ES", "34612345678"],
    ["0033612345678", "ES", "33612345678"],
    ["0054 9 11 1234 5678", "AR", "5491112345678"],
  ])("%j (%s) -> %s", (input, country, expected) => {
    expect(formatPhoneForCountry(input, country)).toBe(expected)
  })

  // Salidas actuales que no deben cambiar
  it.each([
    ["011 1234 5678", "AR", "541112345678"],
    ["0341 555 1234", "AR", "543415551234"],
    ["11 1234 5678", "AR", "541112345678"],
    ["+54 9 11 1234 5678", "AR", "5491112345678"],
    ["612 34 56 78", "ES", "34612345678"],
    ["+34 612345678", "ES", "34612345678"],
  ])("regresion: %j (%s) -> %s", (input, country, expected) => {
    expect(formatPhoneForCountry(input, country)).toBe(expected)
  })
})
