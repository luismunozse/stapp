import { describe, it, expect } from "vitest"
import { toItemPayload } from "@/components/cotizaciones/cotizacion-form"

/**
 * El item del formulario tiene campos que son solo de runtime (precioCompra) y
 * campos que viajan al servidor. Esta funcion decide cuales son cuales.
 */
describe("toItemPayload — ítem de cotización", () => {
  it("manda el servicio del catálogo al servidor", () => {
    const payload = toItemPayload({
      descripcion: "Instalación de Windows",
      cantidad: 1,
      precioUnitario: 25000,
      unidad: "Servicio",
      servicioId: "srv-1",
    })

    expect(payload.servicioId).toBe("srv-1")
  })

  it("manda servicioId en null cuando el ítem no viene del catálogo", () => {
    const payload = toItemPayload({
      descripcion: "Mano de obra suelta",
      cantidad: 1,
      precioUnitario: 8000,
    })

    expect(payload.servicioId).toBeNull()
  })

  it("no le inventa un costo al servicio: precioCompra es solo de runtime", () => {
    const payload = toItemPayload({
      descripcion: "Limpieza interna",
      cantidad: 1,
      precioUnitario: 12000,
      servicioId: "srv-2",
    })

    expect(payload.costoUnitario).toBeNull()
    expect(payload).not.toHaveProperty("precioCompra")
  })

  it("conserva el vínculo con inventario y su costo para los productos", () => {
    const payload = toItemPayload({
      descripcion: "Pantalla",
      cantidad: 2,
      precioUnitario: 40000,
      inventarioId: "inv-1",
      precioCompra: 22000,
    })

    expect(payload.inventarioId).toBe("inv-1")
    expect(payload.costoUnitario).toBe(22000)
    expect(payload.servicioId).toBeNull()
  })
})
