import { describe, it, expect } from "vitest"
import {
  computeDevolucionMonto,
  effectiveUnitNet,
  effectivePaidUnitPrice,
  saleNetTotal,
} from "@/lib/devolucion-refund"

// Sale item shape as stored in items_venta (values may arrive as strings from PostgREST).
const item = (over: Partial<Parameters<typeof effectiveUnitNet>[0]> & { id: string }) => ({
  cantidad: 10,
  precio_unitario: 100,
  descuento: 0,
  tipo_descuento: "MONTO",
  porcentaje_descuento: 0,
  ...over,
})

describe("effectiveUnitNet — precio neto por unidad (descuento de línea)", () => {
  it("sin descuento devuelve el precio bruto", () => {
    expect(effectiveUnitNet(item({ id: "i1" }))).toBeCloseTo(100, 2)
  })

  it("descuento de línea PORCENTAJE resta el % del bruto", () => {
    expect(
      effectiveUnitNet(item({ id: "i1", tipo_descuento: "PORCENTAJE", porcentaje_descuento: 10 }))
    ).toBeCloseTo(90, 2)
  })

  it("descuento de línea MONTO se prorratea por unidad", () => {
    // $100 de descuento total sobre 10 unidades = $10 por unidad → neto 90
    expect(effectiveUnitNet(item({ id: "i1", tipo_descuento: "MONTO", descuento: 100 }))).toBeCloseTo(90, 2)
  })

  it("tolera valores string de PostgREST", () => {
    expect(
      effectiveUnitNet(item({ id: "i1", precio_unitario: "100" as any, descuento: "100" as any }))
    ).toBeCloseTo(90, 2)
  })
})

describe("computeDevolucionMonto — reembolso = porción proporcional de lo pagado", () => {
  it("bruto sin descuentos: devolución total reembolsa el total", () => {
    const items = [item({ id: "i1" })]
    expect(computeDevolucionMonto(1000, items, [{ itemVentaId: "i1", cantidad: 10 }])).toBeCloseTo(1000, 2)
  })

  it("bruto sin descuentos: devolución parcial reembolsa proporcional", () => {
    const items = [item({ id: "i1" })]
    expect(computeDevolucionMonto(1000, items, [{ itemVentaId: "i1", cantidad: 5 }])).toBeCloseTo(500, 2)
  })

  it("descuento de línea 10%: total pagado 900 → reembolso total 900 (no 1000)", () => {
    const items = [item({ id: "i1", tipo_descuento: "PORCENTAJE", porcentaje_descuento: 10 })]
    // ventaTotal ya refleja el neto de línea
    expect(computeDevolucionMonto(900, items, [{ itemVentaId: "i1", cantidad: 10 }])).toBeCloseTo(900, 2)
  })

  it("descuento de línea 10%: devolución parcial (5 uds) reembolsa 450", () => {
    const items = [item({ id: "i1", tipo_descuento: "PORCENTAJE", porcentaje_descuento: 10 })]
    expect(computeDevolucionMonto(900, items, [{ itemVentaId: "i1", cantidad: 5 }])).toBeCloseTo(450, 2)
  })

  it("descuento GLOBAL: se prorratea vía venta.total", () => {
    // 10×100 = 1000 neto de línea, 5% global → total 855
    const items = [item({ id: "i1" })]
    expect(computeDevolucionMonto(855, items, [{ itemVentaId: "i1", cantidad: 10 }])).toBeCloseTo(855, 2)
    expect(computeDevolucionMonto(855, items, [{ itemVentaId: "i1", cantidad: 5 }])).toBeCloseTo(427.5, 2)
  })

  it("IVA en el total (ADITIVO): el reembolso incluye el IVA proporcional", () => {
    // 10×100 = 1000 neto, +21% IVA aditivo → total 1210
    const items = [item({ id: "i1" })]
    expect(computeDevolucionMonto(1210, items, [{ itemVentaId: "i1", cantidad: 5 }])).toBeCloseTo(605, 2)
  })

  it("multi-item: solo reembolsa las líneas devueltas, proporcional a su neto", () => {
    const items = [
      item({ id: "i1", cantidad: 2, precio_unitario: 100 }), // neto 200
      item({ id: "i2", cantidad: 1, precio_unitario: 300, tipo_descuento: "PORCENTAJE", porcentaje_descuento: 50 }), // neto 150
    ]
    // S_net = 350, ventaTotal = 350 (sin global/IVA)
    // devolver todo i2 → 150
    expect(computeDevolucionMonto(350, items, [{ itemVentaId: "i2", cantidad: 1 }])).toBeCloseTo(150, 2)
    // devolver 1 de i1 → 100
    expect(computeDevolucionMonto(350, items, [{ itemVentaId: "i1", cantidad: 1 }])).toBeCloseTo(100, 2)
  })

  it("venta gratis (neto 0): reembolso 0, sin división por cero", () => {
    const items = [item({ id: "i1", tipo_descuento: "PORCENTAJE", porcentaje_descuento: 100 })]
    expect(computeDevolucionMonto(0, items, [{ itemVentaId: "i1", cantidad: 10 }])).toBe(0)
  })

  it("ignora líneas devueltas que no existen en la venta", () => {
    const items = [item({ id: "i1" })]
    expect(computeDevolucionMonto(1000, items, [{ itemVentaId: "no-existe", cantidad: 5 }])).toBe(0)
  })
})

describe("computeDevolucionMonto — cap y true-up en devoluciones secuenciales", () => {
  // Venta con descuento global fuerte: 3 uds × $100 neto = $300, pero total = $100.
  const items = [item({ id: "i1", cantidad: 3, precio_unitario: 100 })]

  it("parcial: cap al remanente (no reembolsa más que lo que resta)", () => {
    // Ya se devolvió $90; una línea que proporcional daría 33.33 se capa a 10.
    expect(
      computeDevolucionMonto(100, items, [{ itemVentaId: "i1", cantidad: 1 }], { priorRefunded: 90 })
    ).toBeCloseTo(10, 2)
  })

  it("TOTAL: true-up al remanente exacto (evita drift de centavos)", () => {
    // Tras dos parciales de 33.33 (66.66 devueltos), la devolución TOTAL cierra en 33.34.
    expect(
      computeDevolucionMonto(100, items, [{ itemVentaId: "i1", cantidad: 1 }], {
        priorRefunded: 66.66,
        isTotal: true,
      })
    ).toBeCloseTo(33.34, 2)
  })

  it("suma de reembolsos secuenciales = venta.total exacto", () => {
    const r1 = computeDevolucionMonto(100, items, [{ itemVentaId: "i1", cantidad: 1 }], { priorRefunded: 0 })
    const r2 = computeDevolucionMonto(100, items, [{ itemVentaId: "i1", cantidad: 1 }], { priorRefunded: r1 })
    const r3 = computeDevolucionMonto(100, items, [{ itemVentaId: "i1", cantidad: 1 }], {
      priorRefunded: r1 + r2,
      isTotal: true,
    })
    expect(r1 + r2 + r3).toBeCloseTo(100, 2)
  })

  it("sin opts: proporcional puro (retrocompatible)", () => {
    expect(computeDevolucionMonto(300, [item({ id: "i1", cantidad: 3, precio_unitario: 100 })], [
      { itemVentaId: "i1", cantidad: 1 },
    ])).toBeCloseTo(100, 2)
  })
})

describe("effectivePaidUnitPrice / saleNetTotal — para items_devolucion consistentes", () => {
  it("saleNetTotal suma el neto de línea de todas las líneas", () => {
    const items = [
      item({ id: "i1", cantidad: 2, precio_unitario: 100 }),
      item({ id: "i2", cantidad: 1, precio_unitario: 300, tipo_descuento: "PORCENTAJE", porcentaje_descuento: 50 }),
    ]
    expect(saleNetTotal(items)).toBeCloseTo(350, 2)
  })

  it("precio pagado por unidad pliega el global/IVA vía total/neto", () => {
    // neto unidad 100, saleNet 1000, total 855 (5% global) → pagado 85.5
    const it = item({ id: "i1", cantidad: 10, precio_unitario: 100 })
    expect(effectivePaidUnitPrice(it, 855, 1000)).toBeCloseTo(85.5, 2)
  })

  it("saleNet 0 → precio 0 (sin división por cero)", () => {
    const it = item({ id: "i1", tipo_descuento: "PORCENTAJE", porcentaje_descuento: 100 })
    expect(effectivePaidUnitPrice(it, 0, 0)).toBe(0)
  })
})
