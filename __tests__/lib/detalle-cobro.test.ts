import { describe, it, expect } from "vitest"
import { calcularDetalleCobro } from "@/lib/ordenes/detalle-cobro"
import { sumaLineasOrden } from "@/lib/servicios/suma-lineas-orden"

const cot = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  numero_cotizacion: "COT-0059",
  estado: "ENVIADA",
  total: "35000.00",
  deleted_at: null,
  reemplazada_por: null,
  items_cotizacion: [
    { id: "i1", descripcion: "PIN DE CARGA A15", cantidad: 1, precio_unitario: "35000", subtotal: "35000", costo_unitario: "7000" },
  ],
  ...over,
})

describe("calcularDetalleCobro", () => {
  it("orden 82: pin de la cotización (35000, costo 7000) + FRP que suma (25000)", () => {
    const d = calcularDetalleCobro({
      cotizaciones: [cot()],
      servicios: [{ id: "s1", nombre: "FRP SAMSUNG A15", cantidad: 1, precioUnitario: 25000, incluidoEnPresupuesto: false }],
    })
    expect(d.total).toBe(60000)
    expect(d.costo).toBe(7000)
    expect(d.ganancia).toBe(53000)
    expect(d.margen).toBe(88.3)
    expect(d.grupos.map((g) => g.titulo)).toEqual(["Presupuesto COT-0059", "Servicios"])
  })

  it("el total coincide con sumaLineasOrden (el número que se cobra)", () => {
    const input = {
      cotizaciones: [cot()],
      servicios: [{ id: "s1", nombre: "FRP", cantidad: 1, precioUnitario: 25000, incluidoEnPresupuesto: false }],
      repuestos: [
        { id: "r1", nombre: "Pin", cantidad: 1, precioUnitario: 7000, precioVentaUnitario: 35000, incluidoEnPresupuesto: true },
        { id: "r2", nombre: "Tornillo", cantidad: 2, precioUnitario: 100, precioVentaUnitario: 500, incluidoEnPresupuesto: false },
      ],
    }
    expect(calcularDetalleCobro(input).total).toBe(sumaLineasOrden(input).total)
  })

  it("repuesto incluido + cotización sin costos: el costo sale del repuesto (sin duplicar precio)", () => {
    const d = calcularDetalleCobro({
      cotizaciones: [cot({ items_cotizacion: [{ id: "i1", descripcion: "Mod g8", cantidad: 1, subtotal: "90000", costo_unitario: null }] , total: "90000" })],
      repuestos: [{ id: "r1", nombre: "Mod g8", cantidad: 1, precioUnitario: 40000, precioVentaUnitario: 90000, incluidoEnPresupuesto: true }],
    })
    expect(d.total).toBe(90000)
    expect(d.costo).toBe(40000)
    expect(d.ganancia).toBe(50000)
  })

  it("repuesto incluido + cotización CON costos: no se cuenta el costo dos veces", () => {
    const d = calcularDetalleCobro({
      cotizaciones: [cot()],
      repuestos: [{ id: "r1", nombre: "Pin", cantidad: 1, precioUnitario: 7000, precioVentaUnitario: 35000, incluidoEnPresupuesto: true }],
    })
    expect(d.total).toBe(35000)
    expect(d.costo).toBe(7000)
  })

  it("descuento global de la cotización: el total de la cotización manda", () => {
    const d = calcularDetalleCobro({ cotizaciones: [cot({ total: "31500" })] })
    expect(d.total).toBe(31500)
    expect(d.grupos[0].filas.at(-1)).toMatchObject({ concepto: "Descuento del presupuesto", precio: -3500 })
  })

  it("sin cotización vigente la marca no tiene efecto", () => {
    const d = calcularDetalleCobro({
      cotizaciones: [cot({ estado: "RECHAZADA" })],
      servicios: [{ id: "s1", nombre: "FRP", cantidad: 1, precioUnitario: 25000, incluidoEnPresupuesto: true }],
    })
    expect(d.total).toBe(25000)
    expect(d.grupos.map((g) => g.titulo)).toEqual(["Servicios"])
  })

  it("orden sin nada: todo en cero y margen null", () => {
    expect(calcularDetalleCobro({})).toEqual({ grupos: [], total: 0, costo: 0, ganancia: 0, margen: null })
  })
})
