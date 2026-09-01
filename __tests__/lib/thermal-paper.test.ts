import { describe, it, expect, beforeEach } from "vitest"
import {
  readAncho,
  saveAncho,
  anchoToPx,
  anchoLogoDots,
  DEFAULT_ANCHO,
  readProfile,
  saveProfile,
  defaultProfile,
  columnasDefault,
} from "@/lib/thermal-paper"

describe("thermal-paper — persistencia del ancho", () => {
  beforeEach(() => localStorage.clear())

  it("devuelve el default (80) cuando no hay nada guardado", () => {
    expect(readAncho()).toBe(80)
    expect(DEFAULT_ANCHO).toBe(80)
  })

  it("guarda y lee 58 (roundtrip)", () => {
    saveAncho(58)
    expect(readAncho()).toBe(58)
  })

  it("ignora un ancho inválido guardado y cae al default", () => {
    localStorage.setItem("stapp:comprobante-ancho", "70")
    expect(readAncho()).toBe(DEFAULT_ANCHO)
  })
})

describe("thermal-paper — conversiones por ancho", () => {
  it("anchoToPx: 58mm -> 219px, 80mm -> 302px (≈96dpi)", () => {
    expect(anchoToPx(58)).toBe(219)
    expect(anchoToPx(80)).toBe(302)
  })

  it("anchoLogoDots: 58mm -> 384pt, 80mm -> 576pt", () => {
    expect(anchoLogoDots(58)).toBe(384)
    expect(anchoLogoDots(80)).toBe(576)
  })
})

describe("thermal-paper — perfil de impresora", () => {
  beforeEach(() => localStorage.clear())

  it("sin nada guardado devuelve el default (80mm, 48 col, cp858, gsv)", () => {
    expect(readProfile()).toEqual({ ancho: 80, columnas: 48, codepage: "cp858", corte: "gsv" })
  })

  it("roundtrip saveProfile/readProfile", () => {
    const p = { ancho: 80 as const, columnas: 42, codepage: "win1252" as const, corte: "esci" as const }
    saveProfile(p)
    expect(readProfile()).toEqual(p)
  })

  it("migra desde la clave legacy de ordenes (stapp:comprobante-ancho)", () => {
    localStorage.setItem("stapp:comprobante-ancho", "58")
    expect(readProfile()).toEqual(defaultProfile(58))
    expect(readProfile().columnas).toBe(32)
  })

  it("migra desde la clave legacy del POS (pos_printer_width)", () => {
    localStorage.setItem("pos_printer_width", "80")
    expect(readProfile()).toEqual(defaultProfile(80))
  })

  it("el perfil guardado gana sobre las claves legacy", () => {
    localStorage.setItem("pos_printer_width", "58")
    saveProfile({ ancho: 80, columnas: 48, codepage: "cp437", corte: "none" })
    expect(readProfile().codepage).toBe("cp437")
  })

  it("JSON corrupto o valores invalidos caen al default", () => {
    localStorage.setItem("stapp:printer-profile", "{no es json")
    expect(readProfile()).toEqual(defaultProfile())
    localStorage.setItem("stapp:printer-profile", JSON.stringify({ ancho: 70, columnas: 99, codepage: "utf8", corte: "laser" }))
    expect(readProfile()).toEqual(defaultProfile())
  })

  it("saveAncho cambia ancho y resetea columnas al default, pero conserva codepage y corte", () => {
    saveProfile({ ancho: 80, columnas: 42, codepage: "win1252", corte: "esci" })
    saveAncho(58)
    expect(readProfile()).toEqual({ ancho: 58, columnas: 32, codepage: "win1252", corte: "esci" })
  })

  it("readAncho delega en el perfil", () => {
    saveProfile({ ancho: 58, columnas: 32, codepage: "cp858", corte: "gsv" })
    expect(readAncho()).toBe(58)
  })

  it("columnasDefault: 58→32, 80→48", () => {
    expect(columnasDefault(58)).toBe(32)
    expect(columnasDefault(80)).toBe(48)
  })
})
