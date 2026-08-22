import { describe, it, expect } from "vitest"
import { construirItemsFactura } from "@/lib/facturacion/items-factura"

/**
 * El detalle de la factura sale de una de cuatro fuentes, en orden de
 * precedencia. Estos tests fijan cuál gana y qué renglones produce cada una.
 */
describe("construirItemsFactura", () => {
  it("prefiere los ítems de la cotización aprobada y respeta su total", () => {
    const { items, subtotal } = construirItemsFactura({
      cotizacion: {
        total: 50000,
        items: [
          { id: "it-1", descripcion: "Instalación de Windows", cantidad: 1, precio_unitario: 25000, subtotal: 25000 },
          { id: "it-2", descripcion: "Pantalla", cantidad: 1, precio_unitario: 25000, subtotal: 25000 },
        ],
      },
      costoFinal: 99999,
      presupuesto: 77777,
      repuestos: [{ nombre: "Ignorado", cantidad: 1, precio_unitario: 1 }],
      servicios: [{ nombre: "Ignorado", cantidad: 1, precio_unitario: 1 }],
    })

    expect(subtotal).toBe(50000)
    expect(items).toHaveLength(2)
    expect(items[0].cotizacionItemId).toBe("it-1")
  })

  it("desglosa los servicios por su nombre en vez de fundirlos en mano de obra", () => {
    const { items } = construirItemsFactura({
      cotizacion: null,
      costoFinal: 40000,
      presupuesto: null,
      repuestos: [],
      servicios: [{ nombre: "Instalación de Windows", cantidad: 1, precio_unitario: 25000 }],
    })

    const servicio = items.find((i) => i.descripcion === "Instalación de Windows")
    expect(servicio).toBeDefined()
    expect(servicio!.subtotal).toBe(25000)
    expect(servicio!.tipo).toBe("SERVICIO")
  })

  it("deja en mano de obra solo lo que no explica ninguna línea", () => {
    const { items, subtotal } = construirItemsFactura({
      cotizacion: null,
      costoFinal: 40000,
      presupuesto: null,
      repuestos: [{ nombre: "Pantalla", cantidad: 1, precio_unitario: 10000 }],
      servicios: [{ nombre: "Instalación de Windows", cantidad: 1, precio_unitario: 25000 }],
    })

    expect(subtotal).toBe(40000)
    const manoDeObra = items.find((i) => i.tipo === "MANO_DE_OBRA")
    expect(manoDeObra!.subtotal).toBe(5000)
  })

  it("no agrega mano de obra cuando las líneas explican todo el costo", () => {
    const { items } = construirItemsFactura({
      cotizacion: null,
      costoFinal: 25000,
      presupuesto: null,
      repuestos: [],
      servicios: [{ nombre: "Instalación de Windows", cantidad: 1, precio_unitario: 25000 }],
    })

    expect(items.some((i) => i.tipo === "MANO_DE_OBRA")).toBe(false)
  })

  it("sin costo final, factura las líneas cargadas y suma su total", () => {
    const { items, subtotal } = construirItemsFactura({
      cotizacion: null,
      costoFinal: null,
      presupuesto: null,
      repuestos: [{ nombre: "Pantalla", cantidad: 2, precio_unitario: 10000 }],
      servicios: [{ nombre: "Mano de obra", cantidad: 1, precio_unitario: 5000 }],
    })

    expect(subtotal).toBe(25000)
    expect(items).toHaveLength(2)
  })

  it("cae al presupuesto como un único renglón cuando no hay nada cargado", () => {
    const { items, subtotal } = construirItemsFactura({
      cotizacion: null,
      costoFinal: null,
      presupuesto: 30000,
      repuestos: [],
      servicios: [],
    })

    expect(subtotal).toBe(30000)
    expect(items).toEqual([
      { descripcion: "Servicio de reparación", cantidad: 1, precioUnitario: 30000, subtotal: 30000, tipo: "SERVICIO" },
    ])
  })

  it("no inventa renglones cuando la orden no tiene ningún monto", () => {
    const { items, subtotal } = construirItemsFactura({
      cotizacion: null,
      costoFinal: null,
      presupuesto: null,
      repuestos: [],
      servicios: [],
    })

    expect(items).toEqual([])
    expect(subtotal).toBe(0)
  })
})
