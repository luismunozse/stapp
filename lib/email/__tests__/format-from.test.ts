import { describe, it, expect } from "vitest"
import { formatFrom } from "../types"

const BASE = "avisos@avisos.stapp.com.ar"
const BASE_CON_NOMBRE = "STApp <avisos@avisos.stapp.com.ar>"

describe("formatFrom", () => {
  it("sin nombre devuelve la base tal cual", () => {
    expect(formatFrom(undefined, BASE)).toBe(BASE)
    expect(formatFrom("", BASE_CON_NOMBRE)).toBe(BASE_CON_NOMBRE)
  })

  it("un nombre simple queda sin comillas, igual que antes", () => {
    expect(formatFrom("Taller Pepe", BASE)).toBe("Taller Pepe <avisos@avisos.stapp.com.ar>")
  })

  it("usa solo la direccion cuando la base trae su propio nombre", () => {
    expect(formatFrom("Taller Pepe", BASE_CON_NOMBRE)).toBe("Taller Pepe <avisos@avisos.stapp.com.ar>")
  })

  it("entrecomilla si hay caracteres especiales de RFC 5322", () => {
    expect(formatFrom("Pepe, S.A.", BASE)).toBe('"Pepe, S.A." <avisos@avisos.stapp.com.ar>')
    expect(formatFrom("Pepe (centro)", BASE)).toBe('"Pepe (centro)" <avisos@avisos.stapp.com.ar>')
    expect(formatFrom("Pepe; Hnos", BASE)).toBe('"Pepe; Hnos" <avisos@avisos.stapp.com.ar>')
  })

  it("quita comillas, angulos y barras invertidas", () => {
    expect(formatFrom('Taller "Pepe", S.A.', BASE)).toBe('"Taller Pepe, S.A." <avisos@avisos.stapp.com.ar>')
    expect(formatFrom("Pepe <x> \\ Hnos", BASE)).toBe("Pepe x Hnos <avisos@avisos.stapp.com.ar>")
  })

  it("neutraliza CR/LF y caracteres de control (inyeccion de headers)", () => {
    const from = formatFrom("Taller\r\nBcc: x@y.com\u0000\u007f", BASE)
    expect(from).not.toMatch(/[\x00-\x1f\x7f]/)
    expect(from).toBe('"Taller Bcc: x@y.com" <avisos@avisos.stapp.com.ar>')
  })

  it("colapsa espacios y recorta", () => {
    expect(formatFrom("  Taller    Pepe  ", BASE)).toBe("Taller Pepe <avisos@avisos.stapp.com.ar>")
  })

  it("si el nombre queda vacio tras limpiarlo usa la base sola", () => {
    expect(formatFrom('<>"\\', BASE)).toBe(BASE)
    expect(formatFrom("\r\n\t ", BASE_CON_NOMBRE)).toBe(BASE_CON_NOMBRE)
  })
})
