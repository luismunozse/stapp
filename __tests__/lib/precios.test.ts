import { describe, it, expect } from "vitest"
import {
  round2,
  descuentoClientePct,
  aplicarDescuento,
  componerDescuentos,
  pctEfectivo,
  sugerirPresupuesto,
} from "@/lib/precios"

describe("round2", () => {
  it("redondea a 2 decimales", () => {
    expect(round2(100 / 3)).toBe(33.33)
  })

  it("no altera valores ya redondeados", () => {
    expect(round2(7225)).toBe(7225)
  })
})

describe("descuentoClientePct", () => {
  it("MINORISTA siempre devuelve 0, incluso con un % guardado", () => {
    expect(descuentoClientePct({ tipoPrecio: "MINORISTA", descuentoPct: 15 })).toBe(0)
  })

  it("MAYORISTA sin % (null) devuelve 0", () => {
    expect(descuentoClientePct({ tipoPrecio: "MAYORISTA", descuentoPct: null })).toBe(0)
  })

  it("MAYORISTA con 15% devuelve 15", () => {
    expect(descuentoClientePct({ tipoPrecio: "MAYORISTA", descuentoPct: 15 })).toBe(15)
  })

  it("pct fuera del rango (0,100] devuelve 0", () => {
    expect(descuentoClientePct({ tipoPrecio: "MAYORISTA", descuentoPct: 0 })).toBe(0)
    expect(descuentoClientePct({ tipoPrecio: "MAYORISTA", descuentoPct: 150 })).toBe(0)
    expect(descuentoClientePct({ tipoPrecio: "MAYORISTA", descuentoPct: -5 })).toBe(0)
  })

  it("cliente null/undefined nunca lanza", () => {
    expect(descuentoClientePct(null)).toBe(0)
    expect(descuentoClientePct(undefined)).toBe(0)
  })
})

describe("aplicarDescuento", () => {
  it("calcula el neto sugerido", () => {
    expect(aplicarDescuento(8500, 15)).toBe(7225)
  })

  it("redondea a 2 decimales en divisiones no exactas", () => {
    expect(aplicarDescuento(100, 100 / 3)).toBe(66.67)
  })

  it("devuelve NaN si precioLista no es finito", () => {
    expect(aplicarDescuento(NaN, 15)).toBeNaN()
  })
})

describe("componerDescuentos", () => {
  it("compone multiplicativamente, no suma (15% + 10% no es 25%)", () => {
    expect(componerDescuentos(15, 10)).toBe(23.5)
  })

  it("componer con 0 devuelve el otro descuento sin cambios", () => {
    expect(componerDescuentos(15, 0)).toBe(15)
  })
})

describe("pctEfectivo", () => {
  it("deriva el % real desde dinero (base lista vs total cobrado)", () => {
    expect(pctEfectivo(10000, 7650)).toBe(23.5)
  })

  it("subtotalLista 0 no divide por cero", () => {
    expect(pctEfectivo(0, 0)).toBe(0)
  })
})

describe("sugerirPresupuesto", () => {
  it("prefilla el neto cuando el operador no tocó el campo", () => {
    expect(
      sugerirPresupuesto({ precioLista: 8500, pct: 15, tocado: false, actual: undefined })
    ).toBe(7225)
  })

  it("deja de sugerir una vez que el operador tocó el campo (el override gana)", () => {
    expect(
      sugerirPresupuesto({ precioLista: 8500, pct: 15, tocado: true, actual: 7000 })
    ).toBe(7000)
  })

  it("limpia la sugerencia cuando se borra el precio de lista", () => {
    expect(
      sugerirPresupuesto({ precioLista: undefined, pct: 15, tocado: false, actual: 7225 })
    ).toBeUndefined()
  })
})
