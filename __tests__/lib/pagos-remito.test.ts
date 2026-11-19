import { describe, it, expect } from "vitest"
import { pagosDeRemitoOrden, porFechaDesc } from "@/lib/facturacion/pagos-remito"

const parcial = (id: string, monto: number, fecha: string, observaciones: string | null = null) => ({
  id, monto: String(monto), metodo_pago: "EFECTIVO", numero_referencia: null, fecha, observaciones,
  cuotas: null, recargo_porcentaje: null, monto_original: null,
})
const cobro = (id: string, monto: number, created_at: string, anulado = false) => ({
  id, monto: String(monto), metodo_pago: "TRANSFERENCIA", numero_referencia: "op-1", created_at,
  observaciones: null, cuotas: 3, recargo_porcentaje: "10", monto_original: null, anulado,
})

describe("pagosDeRemitoOrden: el historial muestra el libro que manda", () => {
  it("orden cobrada sin pagos en el remito → lista los cobros de la orden", () => {
    const r = pagosDeRemitoOrden([], [cobro("c1", 75000, "2026-11-19T10:02:00Z")])
    expect(r).toEqual([
      expect.objectContaining({ id: "c1", monto: 75000, metodoPago: "TRANSFERENCIA", fecha: "2026-11-19T10:02:00Z", referencia: "op-1", cuotas: 3, recargoPorcentaje: 10 }),
    ])
  })

  it("seña espejada en los dos libros → no la duplica", () => {
    const r = pagosDeRemitoOrden(
      [parcial("p1", 20000, "2026-01-15T23:04:00Z", "Seña abonada al momento del ingreso")],
      [cobro("c1", 20000, "2026-01-15T22:50:00Z"), cobro("c2", 35000, "2026-11-19T12:00:00Z")],
    )
    expect(r.map((p) => p.id)).toEqual(["c1", "c2"])
  })

  it("pagos viejos hechos desde el remito (libro mayor) → lista esos", () => {
    const r = pagosDeRemitoOrden([parcial("p1", 10000, "2026-03-13T00:00:00Z")], [])
    expect(r.map((p) => p.id)).toEqual(["p1"])
  })

  it("ignora cobros anulados", () => {
    const r = pagosDeRemitoOrden([], [cobro("c1", 500, "2026-01-01T00:00:00Z", true)])
    expect(r).toEqual([])
  })

  it("porFechaDesc ordena del más nuevo al más viejo", () => {
    const r = pagosDeRemitoOrden([], [cobro("a", 1, "2026-01-01T00:00:00Z"), cobro("b", 1, "2026-02-01T00:00:00Z")]).sort(porFechaDesc)
    expect(r.map((p) => p.id)).toEqual(["b", "a"])
  })
})
