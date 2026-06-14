import { describe, it, expect } from "vitest"
import { isValidImei } from "@/lib/imei"

describe("isValidImei", () => {
  it("acepta exactamente 15 dígitos", () => {
    expect(isValidImei("123456789012345")).toBe(true)
  })
  it("rechaza menos de 15", () => {
    expect(isValidImei("12345")).toBe(false)
  })
  it("rechaza más de 15", () => {
    expect(isValidImei("1234567890123456")).toBe(false)
  })
  it("rechaza con letras", () => {
    expect(isValidImei("12345678901234a")).toBe(false)
  })
  it("vacío es válido (opcional)", () => {
    expect(isValidImei("")).toBe(true)
    expect(isValidImei(null)).toBe(true)
    expect(isValidImei(undefined)).toBe(true)
  })
})
