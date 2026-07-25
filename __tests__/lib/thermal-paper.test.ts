import { describe, it, expect, beforeEach } from "vitest"
import {
  readAncho,
  saveAncho,
  anchoToPx,
  anchoLogoDots,
  DEFAULT_ANCHO,
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
