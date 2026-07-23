import { describe, it, expect } from "vitest"
import { mapVentaToEmitirInput } from "@/lib/facturacion/map-venta"

describe("mapVentaToEmitirInput", () => {
  it("defaults to consumidor final and maps items", () => {
    const venta = { id: "v1", total: 1210, iva_tasa: 21, cliente_nombre: "Juan" }
    const items = [{ cantidad: 1, descripcion: "Servicio", precio_unitario: 1210 }]
    const input = mapVentaToEmitirInput(venta, items)
    expect(input.ventaId).toBe("v1")
    expect(input.receptor.documentoTipo).toBe("CONSUMIDOR FINAL")
    expect(input.items[0].alicuotaIva).toBe(21)
    expect(input.total).toBe(1210)
  })

  it("preserves iva_tasa 0 (exento) instead of defaulting to 21", () => {
    const venta = { id: "v2", total: 100, iva_tasa: 0, cliente_nombre: "Juan" }
    const items = [{ cantidad: 1, descripcion: "Servicio", precio_unitario: 100 }]
    const input = mapVentaToEmitirInput(venta, items)
    expect(input.items[0].alicuotaIva).toBe(0)
  })

  it("defaults alicuotaIva to 21 when iva_tasa is missing", () => {
    const venta = { id: "v3", total: 100, cliente_nombre: "Juan" }
    const items = [{ cantidad: 1, descripcion: "Servicio", precio_unitario: 100 }]
    const input = mapVentaToEmitirInput(venta, items)
    expect(input.items[0].alicuotaIva).toBe(21)
  })

  it("defaults razonSocial to Consumidor Final when cliente_nombre is absent", () => {
    const venta = { id: "v4", total: 100, iva_tasa: 21 }
    const items = [{ cantidad: 1, descripcion: "Servicio", precio_unitario: 100 }]
    const input = mapVentaToEmitirInput(venta, items)
    expect(input.receptor.razonSocial).toBe("Consumidor Final")
  })

  it("maps an empty items array to an empty items list without throwing", () => {
    const venta = { id: "v5", total: 0, iva_tasa: 21 }
    const input = mapVentaToEmitirInput(venta, [])
    expect(input.items).toEqual([])
  })

  it("maps undefined items to an empty items list without throwing", () => {
    const venta = { id: "v6", total: 0, iva_tasa: 21 }
    const input = mapVentaToEmitirInput(venta, undefined as any)
    expect(input.items).toEqual([])
  })
})
