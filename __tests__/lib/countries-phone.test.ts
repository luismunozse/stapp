import { describe, it, expect } from "vitest"
import { formatPhoneForCountry, normalizarTelefonoNacional } from "@/lib/countries"

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

describe("normalizarTelefonoNacional", () => {
  it.each([
    ["5512345678", "5512345678"],
    ["(55) 1234-5678", "5512345678"],
    ["+52 55 1234 5678", "5512345678"],
    ["525512345678", "5512345678"],
    ["+52 1 55 1234 5678", "5512345678"],
    ["5215512345678", "5512345678"],
    ["00525512345678", "5512345678"],
  ])("México: %s se guarda como %s", (raw, esperado) => {
    expect(normalizarTelefonoNacional(raw, "MX")).toEqual({ ok: true, telefono: esperado })
  })

  it("México: un número nacional que empieza con 52 no pierde esos dígitos", () => {
    expect(normalizarTelefonoNacional("5212345678", "MX")).toEqual({ ok: true, telefono: "5212345678" })
  })

  it("México: rechaza un número corto nombrando el código de país", () => {
    const r = normalizarTelefonoNacional("12345678", "MX")
    expect(r).toEqual({
      ok: false,
      motivo: 'El teléfono debe tener exactamente 10 dígitos, sin contar el código de país +52 (recibido: "12345678")',
    })
  })

  it("lo que normaliza termina en el mismo destino de WhatsApp", () => {
    for (const raw of ["+52 55 1234 5678", "5215512345678", "5512345678"]) {
      const r = normalizarTelefonoNacional(raw, "MX")
      expect(r.ok && formatPhoneForCountry(r.telefono, "MX")).toBe("525512345678")
    }
  })

  it("conserva completo un número de otro país escrito con +", () => {
    const r = normalizarTelefonoNacional("+1 (915) 555-0123", "MX")
    expect(r).toEqual({ ok: true, telefono: "+19155550123" })
    expect(r.ok && formatPhoneForCountry(r.telefono, "MX")).toBe("19155550123")
  })

  it("rechaza letras", () => {
    expect(normalizarTelefonoNacional("55 1234 ABCD", "MX").ok).toBe(false)
  })

  it("Chile: acepta 9 dígitos, con o sin +56", () => {
    expect(normalizarTelefonoNacional("912345678", "CL")).toEqual({ ok: true, telefono: "912345678" })
    expect(normalizarTelefonoNacional("+56 9 1234 5678", "CL")).toEqual({ ok: true, telefono: "912345678" })
  })

  it("Argentina / sin país: mismo comportamiento y mensaje que antes", () => {
    expect(normalizarTelefonoNacional("(11) 2345-6789", null)).toEqual({ ok: true, telefono: "1123456789" })
    expect(normalizarTelefonoNacional("+54 11 2345 6789", "AR")).toEqual({ ok: true, telefono: "1123456789" })
    expect(normalizarTelefonoNacional("12", undefined)).toEqual({
      ok: false,
      motivo: 'El teléfono debe tener exactamente 10 dígitos (recibido: "12")',
    })
  })
})
