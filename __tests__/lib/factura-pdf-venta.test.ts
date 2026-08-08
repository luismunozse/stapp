// @vitest-environment node
/**
 * Tests: generateFacturaPDF renders a venta-sourced invoice (data.venta
 * instead of data.orden) without throwing, and produces a non-empty PDF.
 */
import { describe, it, expect } from "vitest"
import { generateFacturaPDF } from "@/lib/pdf"

describe("generateFacturaPDF — venta origin", () => {
  it("renders successfully with data.venta instead of data.orden", async () => {
    const buffer = await generateFacturaPDF({
      numeroFactura: "0001-00000002",
      fecha: new Date("2026-01-02"),
      estadoPago: "PAGADO",
      cliente: { nombre: "Consumidor Final" },
      venta: { numeroVenta: 5 },
      subtotal: 200,
      iva: 0,
      total: 200,
      montoAbonado: 200,
      pagos: [],
    } as any)

    expect(buffer.length).toBeGreaterThan(0)
  })

  it("still renders successfully with data.orden (orden origin, unchanged)", async () => {
    const buffer = await generateFacturaPDF({
      numeroFactura: "0001-00000001",
      fecha: new Date("2026-01-01"),
      estadoPago: "PENDIENTE",
      cliente: { nombre: "Ana" },
      orden: { numeroOrden: 1, codigoOrden: "CEL001", dispositivo: "iPhone" },
      subtotal: 100,
      iva: 0,
      total: 100,
      montoAbonado: 0,
      pagos: [],
    } as any)

    expect(buffer.length).toBeGreaterThan(0)
  })
})
