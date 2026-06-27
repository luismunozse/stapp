// @vitest-environment node
import { describe, it, expect } from "vitest"
import { validarSerie } from "@/lib/imei"

describe("validarSerie", () => {
  it("vacío/null => válido en todos los modos", () => {
    expect(validarSerie("", { validacion: "imei" })).toBe(true)
    expect(validarSerie(null, { validacion: "pattern", pattern: "^X$" })).toBe(true)
    expect(validarSerie(undefined)).toBe(true)
  })
  it("none / sin config => válido", () => {
    expect(validarSerie("cualquier-cosa", { validacion: "none" })).toBe(true)
    expect(validarSerie("cualquier-cosa")).toBe(true)
  })
  it("imei => 15 dígitos", () => {
    expect(validarSerie("123456789012345", { validacion: "imei" })).toBe(true)
    expect(validarSerie("12345", { validacion: "imei" })).toBe(false)
  })
  it("pattern => matchea el regex", () => {
    expect(validarSerie("AB-1234", { validacion: "pattern", pattern: "^[A-Z]{2}-\\d{4}$" })).toBe(true)
    expect(validarSerie("xx", { validacion: "pattern", pattern: "^[A-Z]{2}-\\d{4}$" })).toBe(false)
  })
  it("pattern sin pattern definido => válido", () => {
    expect(validarSerie("lo-que-sea", { validacion: "pattern" })).toBe(true)
  })
  it("regex inválido => fail-safe (válido, no bloquea)", () => {
    expect(validarSerie("algo", { validacion: "pattern", pattern: "[" })).toBe(true)
  })
})
