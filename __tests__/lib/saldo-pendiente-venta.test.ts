import { describe, it, expect } from "vitest"
import { formatVenta, saldoPendienteVenta } from "@/lib/db-utils"

describe("saldoPendienteVenta", () => {
  it("resta lo cobrado y lo que las devoluciones descontaron del saldo", () => {
    const venta = {
      total: "1000",
      monto_abonado: "300",
      devoluciones_venta: [{ monto_devolucion: "500", monto_aplicado_deuda: "500" }],
    }
    expect(saldoPendienteVenta(venta)).toBe(200)
    expect(formatVenta(venta)).toMatchObject({ saldoPendiente: 200, montoAbonado: 300 })
  })

  it("sin la columna de la migración 330 es total menos cobrado", () => {
    expect(saldoPendienteVenta({ total: "1000", monto_abonado: "300", devoluciones_venta: [{ monto_devolucion: "100" }] })).toBe(700)
  })

  it("nunca es negativo", () => {
    expect(saldoPendienteVenta({ total: "100", monto_abonado: "100", devoluciones_venta: [{ monto_aplicado_deuda: "10" }] })).toBe(0)
  })
})
