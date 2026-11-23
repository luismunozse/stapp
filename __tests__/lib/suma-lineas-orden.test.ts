import { describe, it, expect } from "vitest"
import { sumaLineasOrden } from "@/lib/servicios/suma-lineas-orden"

describe("sumaLineasOrden (espejo de suma_lineas_orden, migraciones 420 y 421)", () => {
  it("suma servicios y repuestos a precio de venta", () => {
    expect(
      sumaLineasOrden({
        servicios: [{ cantidad: 1, precioUnitario: 250000 }],
        repuestos: [{ cantidad: 2, precioVentaUnitario: 149550, precioUnitario: 90000 }],
      }),
    ).toEqual({ presupuestos: 0, servicios: 250000, repuestos: 299100, total: 549100 })
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
    ).toEqual({ presupuestos: 0, servicios: 0.3, repuestos: 0.2, total: 0.5 })
  })

  it("sin líneas da 0", () => {
    expect(sumaLineasOrden({ servicios: null, repuestos: undefined }).total).toBe(0)
  })

  // Orden 82 (2026-11-23): cotización con el pin (35000) + servicio FRP (25000)
  // cargado aparte. Cobraba 35000.
  const cot = { id: "c1", numero_cotizacion: "COT-0059", estado: "ENVIADA", total: "35000.00", deleted_at: null, reemplazada_por: null }

  it("con cotización vigente: cotización + líneas que suman al cobro", () => {
    expect(
      sumaLineasOrden({
        cotizaciones: [cot],
        servicios: [{ cantidad: 1, precioUnitario: 25000, incluidoEnPresupuesto: false }],
      }),
    ).toEqual({ presupuestos: 35000, servicios: 25000, repuestos: 0, total: 60000 })
  })

  it("con cotización vigente: lo marcado como incluido no se suma dos veces", () => {
    expect(
      sumaLineasOrden({
        cotizaciones: [cot],
        servicios: [{ cantidad: 1, precioUnitario: 25000, incluidoEnPresupuesto: true }],
        repuestos: [{ cantidad: 1, precioVentaUnitario: 35000, incluidoEnPresupuesto: true }],
      }).total,
    ).toBe(35000)
  })

  it("sin cotización vigente la marca no tiene efecto: cuentan todas las líneas", () => {
    for (const c of [
      { ...cot, estado: "RECHAZADA" },
      { ...cot, deleted_at: "2026-11-23" },
      { ...cot, reemplazada_por: "c2" },
    ]) {
      expect(
        sumaLineasOrden({
          cotizaciones: [c],
          servicios: [{ cantidad: 1, precioUnitario: 25000, incluidoEnPresupuesto: true }],
        }),
      ).toEqual({ presupuestos: 0, servicios: 25000, repuestos: 0, total: 25000 })
    }
  })
})
