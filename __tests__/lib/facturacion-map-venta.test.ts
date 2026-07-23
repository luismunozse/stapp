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
})
