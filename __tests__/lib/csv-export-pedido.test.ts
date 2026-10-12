import { describe, it, expect } from "vitest"
import {
  arrayToCSV,
  calcularCantidadPedido,
  pedidoColumns,
} from "@/lib/csv-export"

/**
 * The purchase-order sheet is not the inventory dump filtered down: it drops
 * the sale price/margin the supplier has no business seeing and adds the one
 * column inventory never had — how many units to order.
 */

const UMBRAL_ORG = 5

function row(overrides: Record<string, any> = {}) {
  return {
    id: "i1",
    codigo: "ABC123",
    nombre: "Pantalla",
    stock: 2,
    stock_minimo: null,
    punto_reorden: null,
    stock_maximo: null,
    precio_compra: 1000,
    precio_venta: 4000,
    proveedor: null,
    proveedores: null,
    ...overrides,
  }
}

describe("calcularCantidadPedido", () => {
  it("falls back to the org threshold when the item has none of its own", () => {
    // umbral 5 -> target 10, stock 2 -> 8
    expect(calcularCantidadPedido({ stock: 2 }, UMBRAL_ORG)).toBe(8)
  })

  it("prefers the item's stock_minimo over the org threshold", () => {
    // umbral 20 -> target 40, stock 10 -> 30
    expect(
      calcularCantidadPedido({ stock: 10, stock_minimo: 20 }, UMBRAL_ORG)
    ).toBe(30)
  })

  it("prefers punto_reorden over stock_minimo", () => {
    // umbral 30 -> target 60, stock 10 -> 50
    expect(
      calcularCantidadPedido(
        { stock: 10, stock_minimo: 20, punto_reorden: 30 },
        UMBRAL_ORG
      )
    ).toBe(50)
  })

  it("uses stock_maximo as the ceiling when it is higher than twice the threshold", () => {
    // max(stock_maximo 100, umbral 5 * 2) = 100, stock 10 -> 90
    expect(
      calcularCantidadPedido({ stock: 10, stock_maximo: 100 }, UMBRAL_ORG)
    ).toBe(90)
  })

  it("returns 0 instead of a negative when stock is already above target", () => {
    expect(calcularCantidadPedido({ stock: 999 }, UMBRAL_ORG)).toBe(0)
  })

  it("treats a missing stock as 0", () => {
    expect(calcularCantidadPedido({ stock: null }, UMBRAL_ORG)).toBe(10)
  })
})

describe("pedidoColumns", () => {
  it("carries the order-specific columns and leaves sale price out", () => {
    const headers = pedidoColumns(true, UMBRAL_ORG).map((c) => c.header)
    expect(headers).toContain("Cantidad a Pedir")
    expect(headers).toContain("Stock Actual")
    expect(headers).toContain("Proveedor")
    expect(headers).not.toContain("Precio Venta")
  })

  it("drops purchase cost and subtotal when the role cannot see cost", () => {
    const headers = pedidoColumns(false, UMBRAL_ORG).map((c) => c.header)
    expect(headers).not.toContain("Precio Compra")
    expect(headers).not.toContain("Subtotal")
    // The sheet is still usable without cost: the order columns survive.
    expect(headers).toContain("Cantidad a Pedir")
  })

  it("prefills the suggested quantity per row", () => {
    const csv = arrayToCSV(
      [row({ stock: 2, stock_minimo: 10 })],
      pedidoColumns(true, UMBRAL_ORG)
    )
    // umbral 10 -> target 20, stock 2 -> 18
    expect(csv.split("\n")[1]).toContain("18")
  })

  it("multiplies the suggested quantity by the purchase cost for the subtotal", () => {
    const csv = arrayToCSV(
      [row({ stock: 0, stock_minimo: 5, precio_compra: 1000 })],
      pedidoColumns(true, UMBRAL_ORG)
    )
    // umbral 5 -> target 10, stock 0 -> 10 units * 1000
    expect(csv).toContain("10000.00")
  })

  it("reads the supplier from the joined row and falls back to the legacy text field", () => {
    const joined = arrayToCSV(
      [row({ proveedores: { nombre: "Proveedor SA" }, proveedor: "Viejo" })],
      pedidoColumns(true, UMBRAL_ORG)
    )
    expect(joined).toContain("Proveedor SA")
    expect(joined).not.toContain("Viejo")

    const legacy = arrayToCSV(
      [row({ proveedores: null, proveedor: "Viejo" })],
      pedidoColumns(true, UMBRAL_ORG)
    )
    expect(legacy).toContain("Viejo")
  })
})
