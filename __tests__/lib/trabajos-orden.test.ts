import { describe, it, expect } from "vitest"
import { construirTrabajos } from "@/lib/ordenes/trabajos-orden"

/**
 * "Trabajo realizado" es lo que el cliente lee en el comprobante. Tiene que
 * incluir los servicios: si no, paga por un trabajo que no figura en ningún lado.
 */
describe("construirTrabajos", () => {
  it("lista los repuestos a precio de VENTA, nunca a costo", () => {
    const trabajos = construirTrabajos({
      repuestos: [{ nombre: "Pantalla", cantidad: 2, precio_venta_unitario: 40000, precio_unitario: 22000 }],
      servicios: [],
    })

    expect(trabajos).toEqual([{ nombre: "Pantalla", cantidad: 2, importe: 80000 }])
  })

  it("incluye las líneas de servicio", () => {
    const trabajos = construirTrabajos({
      repuestos: [],
      servicios: [{ nombre: "Instalación de Windows", cantidad: 1, precio_unitario: 25000 }],
    })

    expect(trabajos).toEqual([{ nombre: "Instalación de Windows", cantidad: 1, importe: 25000 }])
  })

  it("mezcla repuestos y servicios en un solo detalle", () => {
    const trabajos = construirTrabajos({
      repuestos: [{ nombre: "Pantalla", cantidad: 1, precio_venta_unitario: 40000 }],
      servicios: [{ nombre: "Mano de obra", cantidad: 1, precio_unitario: 15000 }],
    })

    expect(trabajos).toHaveLength(2)
    expect(trabajos!.map((t) => t.nombre)).toEqual(["Pantalla", "Mano de obra"])
  })

  it("multiplica por la cantidad del servicio", () => {
    const trabajos = construirTrabajos({
      repuestos: [],
      servicios: [{ nombre: "Hora de taller", cantidad: 3, precio_unitario: 12000 }],
    })

    expect(trabajos![0].importe).toBe(36000)
  })

  it("cae al nombre del inventario cuando el repuesto no tiene nombre propio", () => {
    const trabajos = construirTrabajos({
      repuestos: [{ nombre: null, cantidad: 1, precio_venta_unitario: 5000, inventario: { nombre: "Cable HDMI" } }],
      servicios: [],
    })

    expect(trabajos![0].nombre).toBe("Cable HDMI")
  })

  it("devuelve null cuando no hay ni repuestos ni servicios", () => {
    expect(construirTrabajos({ repuestos: [], servicios: [] })).toBeNull()
  })

  it("tolera que las relaciones vengan sin cargar", () => {
    expect(construirTrabajos({ repuestos: null, servicios: null })).toBeNull()
  })

  it("un repuesto anterior a la migración 286 no aporta importe, pero sigue figurando", () => {
    const trabajos = construirTrabajos({
      repuestos: [{ nombre: "Bisagra", cantidad: 1, precio_venta_unitario: null }],
      servicios: [],
    })

    expect(trabajos).toEqual([{ nombre: "Bisagra", cantidad: 1, importe: 0 }])
  })
})
