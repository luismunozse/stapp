import { describe, it, expect } from "vitest"
import { buildVentaPayload } from "../pos-payload"
import type { PosCartItem } from "../pos-types"

const linea = (over: Partial<PosCartItem> = {}): PosCartItem => ({
  lineId: "l1",
  inventarioId: "inv-1",
  codigo: "C1",
  nombre: "Producto",
  precioUnitario: 1000,
  cantidad: 1,
  stockDisponible: 5,
  diasGarantia: 0,
  trackeaSeries: false,
  serieIds: [],
  ...over,
})

const base = {
  cliente: { id: null, nombre: "", telefono: "" },
  pagosLines: [],
  pagoParcial: false,
  observaciones: "",
  idempotencyKey: "k1",
}

describe("buildVentaPayload con divisa", () => {
  it("una línea en divisa manda precioOrigen y el payload lleva tipoCambio", () => {
    const p = buildVentaPayload({
      ...base,
      items: [linea({ moneda: "USD", precioOrigen: 10, precioUnitario: 12000 })],
      tipoCambio: 1200,
    })
    expect(p.items[0].precioOrigen).toBe(10)
    expect(p.items[0].precioUnitario).toBe(12000)
    expect(p.tipoCambio).toBe(1200)
  })

  it("solo las líneas en divisa llevan precioOrigen", () => {
    const p = buildVentaPayload({
      ...base,
      items: [linea({ moneda: "EUR", precioOrigen: 5 }), linea({ lineId: "l2" })],
      tipoCambio: 1300,
    })
    expect(p.items[0].precioOrigen).toBe(5)
    expect("precioOrigen" in p.items[1]).toBe(false)
  })

  it("sin líneas en divisa no hay tipoCambio ni precioOrigen en el JSON", () => {
    const p = buildVentaPayload({ ...base, items: [linea({ moneda: null, precioOrigen: null })], tipoCambio: 1200 })
    const json = JSON.stringify(p)
    expect(json).not.toContain("tipoCambio")
    expect(json).not.toContain("precioOrigen")
  })

  it("línea en divisa sin cotización disponible no manda tipoCambio", () => {
    const p = buildVentaPayload({ ...base, items: [linea({ moneda: "USD", precioOrigen: 10 })], tipoCambio: null })
    expect("tipoCambio" in p).toBe(false)
  })

  it("un precioOrigen 0 o negativo no viaja (el servidor usa el de lista)", () => {
    const p = buildVentaPayload({
      ...base,
      items: [linea({ moneda: "USD", precioOrigen: 0 }), linea({ lineId: "l2", moneda: "USD", precioOrigen: -3 })],
      tipoCambio: 1200,
    })
    expect("precioOrigen" in p.items[0]).toBe(false)
    expect("precioOrigen" in p.items[1]).toBe(false)
  })
})
