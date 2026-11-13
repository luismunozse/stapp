import { describe, it, expect } from "vitest"
import { rasterSize } from "@/lib/escpos-image"
import { logoMaxDots } from "@/lib/thermal-paper"

describe("rasterSize — tamaño del logo en puntos", () => {
  it("sin tope de alto, un logo cuadrado grande ocupa todo el ancho", () => {
    expect(rasterSize(1000, 1000, 576)).toEqual({ width: 576, height: 576 })
  })

  it("con tope de alto, el logo cuadrado se achica sin deformarse", () => {
    const size = rasterSize(1000, 1000, 424, 212)!
    expect(size.height).toBeLessThanOrEqual(212)
    expect(size.width).toBe(size.height)
    expect(size.width % 8).toBe(0)
  })

  it("un logo apaisado queda limitado por el ancho", () => {
    expect(rasterSize(1200, 300, 424, 212)).toEqual({ width: 424, height: 106 })
  })

  it("no agranda un logo chico", () => {
    expect(rasterSize(160, 80, 424, 212)).toEqual({ width: 160, height: 80 })
  })

  it("devuelve null si no queda nada que imprimir", () => {
    expect(rasterSize(4, 4, 424, 212)).toBeNull()
    expect(rasterSize(0, 100, 424, 212)).toBeNull()
  })
})

describe("logoMaxDots — tope del logo por ancho de rollo", () => {
  it("80mm: mismo tamaño que la vista previa (≈53×26mm)", () => {
    expect(logoMaxDots(80)).toEqual({ maxWidth: 424, maxHeight: 212 })
  })

  it("58mm: no pasa del ancho del cabezal", () => {
    expect(logoMaxDots(58)).toEqual({ maxWidth: 384, maxHeight: 212 })
  })
})
