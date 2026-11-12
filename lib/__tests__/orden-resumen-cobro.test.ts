import { describe, it, expect } from "vitest"
import { resumenCobroOrden } from "@/lib/ordenes/resumen-cobro"

describe("resumenCobroOrden", () => {
  it("con costo final y saldo: Debe con el pendiente (descuento y NC restan)", () => {
    expect(
      resumenCobroOrden({ estado: "REPARADO", costoFinal: 10000, totalCobrado: 3000, descuentoCobro: 500, aplicadoNotasCredito: 1500 })
    ).toEqual({ tono: "warning", tipo: "debe", monto: 5000 })
  })

  it("sin saldo: Pagado", () => {
    expect(resumenCobroOrden({ estado: "ENTREGADO", costoFinal: 10000, totalCobrado: 10000 })).toEqual({ tono: "success", tipo: "pagado" })
  })

  it("sin costo final pero con seña: Seña", () => {
    expect(resumenCobroOrden({ estado: "EN_REPARACION", costoFinal: null, sena: 2000 })).toEqual({ tono: "info", tipo: "sena", monto: 2000 })
  })

  it("sin costo ni seña, o cancelada: nada", () => {
    expect(resumenCobroOrden({ estado: "RECIBIDO" })).toBeNull()
    expect(resumenCobroOrden({ estado: "CANCELADO", costoFinal: 5000 })).toBeNull()
    expect(resumenCobroOrden({ estado: "ENTREGADO_SIN_REPARACION", costoFinal: 5000 })).toBeNull()
  })

  it("entregada sin cobro: Sin cargo", () => {
    expect(resumenCobroOrden({ estado: "ENTREGADO_SIN_COBRO", costoFinal: 5000 })).toEqual({ tono: "neutral", tipo: "sin_cargo" })
  })

  it("los centavos de redondeo no dejan un Debe $0", () => {
    expect(resumenCobroOrden({ estado: "ENTREGADO", costoFinal: 0.3, totalCobrado: 0.1 + 0.2 })?.tipo).toBe("pagado")
  })
})
