import { describe, it, expect } from "vitest"
import {
  COUNTRY_OPTIONS,
  formatPhoneForCountry,
  getCountryConfig,
  getIvaGeneral,
} from "@/lib/countries"

describe("countries — Espana", () => {
  it("expone la config de ES con EUR, Europe/Madrid y 34", () => {
    const es = getCountryConfig("ES")
    expect(es.code).toBe("ES")
    expect(es.defaultCurrency).toBe("EUR")
    expect(es.defaultTimezone).toBe("Europe/Madrid")
    expect(es.phoneCode).toBe("34")
    expect(es.phoneNationalMinDigits).toBe(9)
    expect(es.locale).toBe("es-ES")
  })

  it("usa IVA general 21% con tipos 0/4/10/21", () => {
    expect(getIvaGeneral("ES")).toBe(21)
    expect(getCountryConfig("ES").ivaOptions).toEqual([0, 4, 10, 21])
  })

  it("aparece en el selector de paises", () => {
    expect(COUNTRY_OPTIONS).toContainEqual({ value: "ES", label: "España (+34)" })
  })

  describe("DNI/NIE", () => {
    const { personalIdRegex: re } = getCountryConfig("ES")
    it.each(["", "12345678Z", "12345678-Z", "12345678z", "X1234567L", "y1234567l", "Z1234567L"])(
      "acepta %j",
      (v) => expect(re.test(v)).toBe(true)
    )
    it.each(["1234567", "123456789", "ABCDEFGHI", "12345678ZZ", "A1234567L", "hola"])(
      "rechaza %j",
      (v) => expect(re.test(v)).toBe(false)
    )
  })

  describe("NIF", () => {
    const { taxIdRegex: re } = getCountryConfig("ES")
    it.each(["", "B12345678", "A1234567J", "b12345678", "12345678Z", "X1234567L"])(
      "acepta %j",
      (v) => expect(re.test(v)).toBe(true)
    )
    it.each(["B1234567", "B123456789", "1234", "hola", "12345678ZZ"])(
      "rechaza %j",
      (v) => expect(re.test(v)).toBe(false)
    )
  })

  describe("formatPhoneForCountry", () => {
    it("antepone 34 a un movil local", () => {
      expect(formatPhoneForCountry("612 34 56 78", "ES")).toBe("34612345678")
    })
    it("deja intacto un numero que ya trae +34", () => {
      expect(formatPhoneForCountry("+34 612345678", "ES")).toBe("34612345678")
    })
  })
})

describe("countries — teclado de los campos de ID", () => {
  it("ES admite letras en DNI/NIE y NIF", () => {
    const es = getCountryConfig("ES")
    expect(es.personalIdInputMode).toBe("text")
    expect(es.taxIdInputMode).toBe("text")
  })

  it("AR mantiene el teclado numerico", () => {
    const ar = getCountryConfig("AR")
    expect(ar.personalIdInputMode).toBe("numeric")
    expect(ar.taxIdInputMode).toBe("numeric")
  })

  it.each(["MX", "CL", "VE", "NI"] as const)("%s admite letras en ambos IDs", (code) => {
    const c = getCountryConfig(code)
    expect(c.personalIdInputMode).toBe("text")
    expect(c.taxIdInputMode).toBe("text")
  })
})
