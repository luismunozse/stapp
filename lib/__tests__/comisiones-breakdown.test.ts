import { describe, it, expect } from "vitest"
import { orderBaseBreakdown } from "@/lib/commissions/breakdown"

const row = (o: Record<string, unknown> = {}) => ({
  tipo: "ORIGINAL",
  pagado: false,
  baseTipo: "MANO_DE_OBRA" as const,
  documentoTotal: 1000,
  documentoMonto: 850,
  documentoCostoRepuestos: 200,
  ...o,
})

const keys = (r: ReturnType<typeof orderBaseBreakdown>) => r.map((l) => l.key)

describe("orderBaseBreakdown", () => {
  it("labour base: final cost, discounts and credit notes, parts", () => {
    const lines = orderBaseBreakdown(row())
    expect(keys(lines)).toEqual(["costoFinal", "descuentos", "repuestos"])
    expect(lines.map((l) => l.amount)).toEqual([1000, 150, 200])
  })

  it("order-amount base has no parts line", () => {
    expect(keys(orderBaseBreakdown(row({ baseTipo: "MONTO_ORDEN" })))).toEqual(["costoFinal", "descuentos"])
  })

  it("no discount line when nothing was discounted", () => {
    expect(keys(orderBaseBreakdown(row({ documentoMonto: 1000 })))).toEqual(["costoFinal", "repuestos"])
  })

  it("rounds to cents and never shows a negative or noise discount", () => {
    expect(keys(orderBaseBreakdown(row({ documentoTotal: 1000.1, documentoMonto: 1000.1 + 1e-12 })))).not.toContain("descuentos")
    expect(keys(orderBaseBreakdown(row({ documentoTotal: 1000, documentoMonto: 1200 })))).not.toContain("descuentos")
  })

  it("no discount line when the final cost is unknown", () => {
    expect(keys(orderBaseBreakdown(row({ documentoTotal: null })))).not.toContain("descuentos")
  })

  it("paid rows, adjustments and rows without a base kind have no breakdown", () => {
    expect(orderBaseBreakdown(row({ pagado: true }))).toEqual([])
    expect(orderBaseBreakdown(row({ tipo: "AJUSTE_DEVOLUCION" }))).toEqual([])
    expect(orderBaseBreakdown(row({ baseTipo: null }))).toEqual([])
  })
})
