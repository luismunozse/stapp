import { describe, it, expect } from "vitest"
import { lineasComprobante } from "@/lib/facturacion/comprobante-lineas"

const detalle = [
  { cantidad: 2, descripcion: "Funda", importeUnitario: 5000, importe: 10000, alicuotaIva: 21 },
  { cantidad: 3, descripcion: "Vidrio", importeUnitario: 2000.3333, importe: 6001, alicuotaIva: 21 },
]

describe("lineasComprobante", () => {
  it("B: las lineas ya vienen con IVA incluido; el IVA contenido es el persistido", () => {
    const r = lineasComprobante(detalle, "B", { importeIva: 2777.69, importeTotal: 16001 })
    expect(r.lineas).toEqual([
      { descripcion: "Funda", cantidad: 2, unitario: 5000, importe: 10000 },
      { descripcion: "Vidrio", cantidad: 3, unitario: 2000.33, importe: 6001 },
    ])
    expect(r.ivaContenido).toBe(2777.69)
    expect(r.total).toBe(16001)
  })

  it("C: sin IVA contenido (monotributo no discrimina ni informa IVA)", () => {
    const r = lineasComprobante(detalle, "C", { importeIva: 0, importeTotal: 16001 })
    expect(r.ivaContenido).toBeNull()
    expect(r.total).toBe(16001)
  })

  it("el total es siempre el persistido, nunca la suma de las lineas", () => {
    expect(lineasComprobante(detalle, "B", { importeIva: 1, importeTotal: 99 }).total).toBe(99)
  })

  it("sin importe de linea usa unitario x cantidad redondeado al centavo", () => {
    const r = lineasComprobante([{ cantidad: 3, descripcion: "X", importeUnitario: 0.1, alicuotaIva: 21 }], "C", {
      importeIva: 0,
      importeTotal: 0.3,
    })
    expect(r.lineas[0].importe).toBe(0.3)
  })

  it("detalle ausente o no-array: sin lineas, no revienta", () => {
    expect(lineasComprobante(null, "B", { importeIva: 0, importeTotal: 0 }).lineas).toEqual([])
    expect(lineasComprobante({ x: 1 }, "B", { importeIva: 0, importeTotal: 0 }).lineas).toEqual([])
  })

  it("ignora lineas malformadas", () => {
    const r = lineasComprobante([null, { descripcion: "ok", cantidad: 1, importeUnitario: 5 }, "x"], "C", {
      importeIva: 0,
      importeTotal: 5,
    })
    expect(r.lineas).toHaveLength(1)
  })
})
