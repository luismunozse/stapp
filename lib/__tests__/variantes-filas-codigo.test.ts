// @vitest-environment node
import { describe, it, expect } from "vitest"
import { generarCodigoVariante } from "@/lib/variantes-filas"

describe("generarCodigoVariante", () => {
  it("derives {base}-{abbreviation} for one value", () => {
    expect(generarCodigoVariante("FX", ["Rojo"], [])).toBe("FX-ROJ")
    expect(generarCodigoVariante("FX", ["Azul"], [])).toBe("FX-AZU")
  })

  it("joins the abbreviations of several values in option order", () => {
    expect(generarCodigoVariante("FX", ["Azul", "M"], [])).toBe("FX-AZU-M")
    expect(generarCodigoVariante("FX", ["M", "Azul", "XL"], [])).toBe("FX-M-AZU-XL")
  })

  it("keeps Rojo and Rosado apart (three letters, never both RO)", () => {
    const rojo = generarCodigoVariante("FX", ["Rojo"], [])
    const rosado = generarCodigoVariante("FX", ["Rosado"], [])
    expect(rojo).toBe("FX-ROJ")
    expect(rosado).toBe("FX-ROS")
    expect(rojo).not.toBe(rosado)
  })

  it("folds accents and n-tilde to ASCII, whatever the case", () => {
    expect(generarCodigoVariante("FX", ["Rojó"], [])).toBe("FX-ROJ")
    expect(generarCodigoVariante("FX", ["Ñandú"], [])).toBe("FX-NAN")
    expect(generarCodigoVariante("FX", ["ÁMBAR"], [])).toBe("FX-AMB")
  })

  it("uses the initials of a multi-word value and keeps numeric words whole", () => {
    expect(generarCodigoVariante("FX", ["Azul marino"], [])).toBe("FX-AM")
    expect(generarCodigoVariante("FX", ["128 GB"], [])).toBe("FX-128G")
    expect(generarCodigoVariante("FX", ["256"], [])).toBe("FX-256")
  })

  it("caps a number at four digits and treats a word that mixes digits and letters as a word", () => {
    expect(generarCodigoVariante("FX", ["12345"], [])).toBe("FX-1234")
    expect(generarCodigoVariante("FX", ["12345 GB"], [])).toBe("FX-1234G")
    expect(generarCodigoVariante("FX", ["Talle 2XL"], [])).toBe("FX-T2")
  })

  it("falls back to X for a value with no ASCII letter or digit", () => {
    expect(generarCodigoVariante("FX", [String.fromCodePoint(0x8d64)], [])).toBe("FX-X")
    expect(generarCodigoVariante("FX", ["-"], [])).toBe("FX-X")
  })

  it("handles an empty or blank base code without a leading dash", () => {
    expect(generarCodigoVariante("", ["Rojo", "M"], [])).toBe("ROJ-M")
    expect(generarCodigoVariante("   ", ["Rojo"], [])).toBe("ROJ")
    expect(generarCodigoVariante("  FX  ", ["Rojo"], [])).toBe("FX-ROJ")
  })

  it("returns the base alone when there are no values", () => {
    expect(generarCodigoVariante("FX", [], [])).toBe("FX")
    expect(generarCodigoVariante("B".repeat(120), [], [])).toHaveLength(100)
  })

  it("is deterministic", () => {
    const usados = ["FX-ROJ"]
    expect(generarCodigoVariante("FX", ["Rojo"], usados)).toBe(generarCodigoVariante("FX", ["Rojo"], usados))
  })

  it("appends a numeric suffix on a collision, the first free one", () => {
    expect(generarCodigoVariante("FX", ["Rojo"], ["FX-ROJ"])).toBe("FX-ROJ-2")
    expect(generarCodigoVariante("FX", ["Rojo"], ["FX-ROJ", "FX-ROJ-2"])).toBe("FX-ROJ-3")
    expect(generarCodigoVariante("FX", ["Rojo"], ["FX-ROJ", "FX-ROJ-3"])).toBe("FX-ROJ-2")
  })

  it("compares codes case-insensitively and accepts any iterable", () => {
    expect(generarCodigoVariante("FX", ["Rojo"], ["fx-roj"])).toBe("FX-ROJ-2")
    expect(generarCodigoVariante("FX", ["Rojo"], new Set(["FX-ROJ"]))).toBe("FX-ROJ-2")
    expect(generarCodigoVariante("FX", ["Rojo"], new Set(["FX-AZU"]))).toBe("FX-ROJ")
  })

  it("two values that abbreviate alike get different codes through the suffix", () => {
    const primero = generarCodigoVariante("FX", ["Azul claro"], [])
    const segundo = generarCodigoVariante("FX", ["Azul cielo"], [primero])
    expect(primero).toBe("FX-AC")
    expect(segundo).toBe("FX-AC-2")
  })

  it("cuts by code points: no lone surrogate at the boundary, and the cap counts characters", () => {
    // 95 letters + 2 emoji: the room left for the base is 96 code points, so exactly one emoji fits.
    const base = "B".repeat(95) + "😀😀"
    const codigo = generarCodigoVariante(base, ["Rojo"], [])
    expect(codigo).toBe("B".repeat(95) + "😀-ROJ")
    expect(codigo.isWellFormed()).toBe(true)
    expect(Array.from(codigo)).toHaveLength(100)
    // Only emoji: 100 code points are 200 UTF-16 units and still a valid code.
    const todos = generarCodigoVariante("😀".repeat(120), [], [])
    expect(Array.from(todos)).toHaveLength(100)
    expect(todos.isWellFormed()).toBe(true)
    const conSufijo = generarCodigoVariante("😀".repeat(120), ["Rojo"], ["😀".repeat(96) + "-ROJ"])
    expect(conSufijo).toBe("😀".repeat(94) + "-ROJ-2")
  })

  it("never exceeds the 100 character cap, suffix included", () => {
    const base = "B".repeat(120)
    const sinColision = generarCodigoVariante(base, ["Rojo"], [])
    expect(sinColision.length).toBe(100)
    const conColision = generarCodigoVariante(base, ["Rojo"], [sinColision])
    expect(conColision.length).toBe(100)
    expect(conColision.endsWith("-2")).toBe(true)
    expect(conColision).not.toBe(sinColision)
  })
})
