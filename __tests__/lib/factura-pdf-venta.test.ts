// @vitest-environment node
/**
 * Tests: generateFacturaPDF renders a venta-sourced invoice (data.venta
 * instead of data.orden) without throwing, and produces a non-empty PDF.
 * Also covers items_factura itemization for both origins (venta and orden),
 * and the zero-items fallback to the aggregate-only layout.
 */
import { describe, it, expect } from "vitest"
import { generateFacturaPDF } from "@/lib/pdf"
import { extractPdfText } from "./pdf-text-helper"

describe("generateFacturaPDF — venta origin", () => {
  it("renders successfully with data.venta instead of data.orden, no item table when items is omitted", async () => {
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
    const text = await extractPdfText(buffer)
    expect(text).not.toContain("DETALLE DE ITEMS")
  })

  it("still renders successfully with data.orden (orden origin, unchanged), no item table when items is omitted", async () => {
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
    const text = await extractPdfText(buffer)
    expect(text).not.toContain("DETALLE DE ITEMS")
  })

  it("renders items_factura rows for a venta-sourced invoice", async () => {
    const buffer = await generateFacturaPDF({
      numeroFactura: "0001-00000003",
      fecha: new Date("2026-01-03"),
      estadoPago: "PAGADO",
      cliente: { nombre: "Consumidor Final" },
      venta: { numeroVenta: 6 },
      items: [
        { descripcion: "PANTALLA XPHONE12", cantidad: 1, precioUnitario: 150, subtotal: 150 },
        { descripcion: "MANO DE OBRA REPARACION", cantidad: 1, precioUnitario: 50, subtotal: 50 },
      ],
      subtotal: 200,
      iva: 0,
      total: 200,
      montoAbonado: 200,
      pagos: [],
    } as any)

    expect(buffer.length).toBeGreaterThan(0)
    const text = await extractPdfText(buffer)
    expect(text).toContain("DETALLE DE ITEMS")
    expect(text).toContain("PANTALLA XPHONE12")
    expect(text).toContain("MANO DE OBRA REPARACION")
  })

  it("renders items_factura rows for an orden-sourced invoice", async () => {
    const buffer = await generateFacturaPDF({
      numeroFactura: "0001-00000004",
      fecha: new Date("2026-01-04"),
      estadoPago: "PENDIENTE",
      cliente: { nombre: "Ana" },
      orden: { numeroOrden: 2, codigoOrden: "CEL002", dispositivo: "iPhone" },
      items: [
        { descripcion: "BATERIA GALAXYX10", cantidad: 1, precioUnitario: 80, subtotal: 80 },
        { descripcion: "SERVICIO DIAGNOSTICO", cantidad: 1, precioUnitario: 20, subtotal: 20 },
      ],
      subtotal: 100,
      iva: 0,
      total: 100,
      montoAbonado: 0,
      pagos: [],
    } as any)

    expect(buffer.length).toBeGreaterThan(0)
    const text = await extractPdfText(buffer)
    expect(text).toContain("DETALLE DE ITEMS")
    expect(text).toContain("BATERIA GALAXYX10")
    expect(text).toContain("SERVICIO DIAGNOSTICO")
  })
})
