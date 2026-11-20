import { describe, it, expect } from "vitest"
import { sumaLineasOrden } from "@/lib/servicios/suma-lineas-orden"

describe("sumaLineasOrden (espejo de suma_lineas_orden, migración 420)", () => {
  it("suma servicios y repuestos a precio de venta", () => {
    expect(
      sumaLineasOrden({
        servicios: [{ cantidad: 1, precioUnitario: 250000 }],
        repuestos: [{ cantidad: 2, precioVentaUnitario: 149550, precioUnitario: 90000 }],
      }),
    ).toEqual({ servicios: 250000, repuestos: 299100, total: 549100 })
  })

  it("un repuesto sin precio de venta (previo a la 286) cae al costo", () => {
    expect(
      sumaLineasOrden({ repuestos: [{ cantidad: 1, precioVentaUnitario: null, precioUnitario: 500 }] }).total,
    ).toBe(500)
  })

  it("sin precio de venta ni costo aporta 0", () => {
    expect(
      sumaLineasOrden({ repuestos: [{ cantidad: 3, precioVentaUnitario: null, precioUnitario: null }] }).total,
    ).toBe(0)
  })

  it("acepta strings de DECIMAL y redondea a centavos", () => {
    expect(
      sumaLineasOrden({
        servicios: [{ cantidad: 3, precioUnitario: "0.10" }],
        repuestos: [{ cantidad: 1, precioVentaUnitario: "0.20" }],
      }),
    ).toEqual({ servicios: 0.3, repuestos: 0.2, total: 0.5 })
  })

  it("sin líneas da 0", () => {
    expect(sumaLineasOrden({ servicios: null, repuestos: undefined }).total).toBe(0)
  })
})
