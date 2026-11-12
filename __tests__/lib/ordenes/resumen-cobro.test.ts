import { describe, it, expect } from "vitest"
import { aplicarCargosCuentaCorriente, resumenCobroOrden, resumenCobroDeFila } from "@/lib/ordenes/resumen-cobro"
import { pendienteOrden } from "@/lib/ordenes/pendiente"

const base = { estado: "REPARADO", costoFinal: 1000, descuentoCobro: 0, totalCobrado: 0, aplicadoNotasCredito: 0 }

describe("resumenCobroOrden", () => {
  it("sin nada cobrado: sin cobrar y debe el total", () => {
    expect(resumenCobroOrden(base)).toEqual({ estadoPago: "SIN_COBRAR", saldoPendiente: 1000 })
  })

  it("con un cobro parcial: pago parcial y debe el resto", () => {
    expect(resumenCobroOrden({ ...base, totalCobrado: 300 })).toEqual({ estadoPago: "PARCIAL", saldoPendiente: 700 })
  })

  it("descuento de cobro y notas de crédito bajan el saldo, igual que pendienteOrden()", () => {
    const m = { ...base, descuentoCobro: 100, totalCobrado: 200, aplicadoNotasCredito: 150 }
    expect(resumenCobroOrden(m).saldoPendiente).toBe(pendienteOrden(m))
    expect(resumenCobroOrden(m)).toEqual({ estadoPago: "PARCIAL", saldoPendiente: 550 })
  })

  it("una NC sola cuenta como cubierto: pago parcial, no sin cobrar", () => {
    expect(resumenCobroOrden({ ...base, aplicadoNotasCredito: 400 }).estadoPago).toBe("PARCIAL")
  })

  it("cobrado completo (o de más): pagado y saldo 0, nunca negativo", () => {
    expect(resumenCobroOrden({ ...base, totalCobrado: 1000 })).toEqual({ estadoPago: "PAGADO", saldoPendiente: 0 })
    expect(resumenCobroOrden({ ...base, totalCobrado: 1200 })).toEqual({ estadoPago: "PAGADO", saldoPendiente: 0 })
  })

  it("redondea a centavos (sin residuos de coma flotante)", () => {
    expect(resumenCobroOrden({ ...base, costoFinal: 0.3, totalCobrado: 0.1 + 0.2 })).toEqual({
      estadoPago: "PAGADO",
      saldoPendiente: 0,
    })
    expect(resumenCobroOrden({ ...base, costoFinal: 100.1, totalCobrado: 50.05 }).saldoPendiente).toBe(50.05)
  })

  it("cancelada, sin reparación o entregada sin cobro: sin cargo, aunque tenga costo", () => {
    for (const estado of ["CANCELADO", "SIN_REPARACION", "ENTREGADO_SIN_COBRO"]) {
      expect(resumenCobroOrden({ ...base, estado })).toEqual({ estadoPago: "SIN_CARGO", saldoPendiente: 0 })
    }
  })

  it("costo final 0 o descontado entero: sin cargo", () => {
    expect(resumenCobroOrden({ ...base, costoFinal: 0 })).toEqual({ estadoPago: "SIN_CARGO", saldoPendiente: 0 })
    expect(resumenCobroOrden({ ...base, descuentoCobro: 1000 }).estadoPago).toBe("SIN_CARGO")
  })

  it("en curso sin precio final: con seña si dejó plata, si no nada", () => {
    expect(resumenCobroOrden({ ...base, estado: "EN_REPARACION", costoFinal: null, totalCobrado: 500 })).toEqual({
      estadoPago: "SENA",
      saldoPendiente: 0,
    })
    expect(resumenCobroOrden({ ...base, estado: "RECIBIDO", costoFinal: null })).toEqual({
      estadoPago: null,
      saldoPendiente: 0,
    })
  })

  it("cerrada sin precio ni cobros: sin cargo", () => {
    expect(resumenCobroOrden({ ...base, estado: "ENTREGADO_SIN_REPARACION", costoFinal: null }).estadoPago).toBe("SIN_CARGO")
  })
})

describe("resumenCobroDeFila", () => {
  it("lee la fila cruda (DECIMAL como string) e ignora las NC anuladas", () => {
    expect(
      resumenCobroDeFila({
        estado: "ENTREGADO",
        costo_final: "1500.00",
        descuento_cobro: "0",
        total_cobrado: "500.00",
        notas_credito: [
          { monto_aplicado_deuda: "200", anulada: false },
          { monto_aplicado_deuda: "999", anulada: true },
        ],
      })
    ).toEqual({ estadoPago: "PARCIAL", saldoPendiente: 800 })
  })

  it("costo_final null no se lee como 0", () => {
    expect(resumenCobroDeFila({ estado: "RECIBIDO", costo_final: null, total_cobrado: "0" }).estadoPago).toBeNull()
  })
})

describe("aplicarCargosCuentaCorriente", () => {
  const conSaldo = resumenCobroOrden({ ...base, estado: "ENTREGADO", totalCobrado: 200 })

  it("con un CARGO vigente: en cuenta corriente, sin 'Debe' en la orden", () => {
    expect(aplicarCargosCuentaCorriente(conSaldo, [{ monto: "800.00", revertido_at: null }])).toEqual({
      estadoPago: "CUENTA_CORRIENTE",
      saldoPendiente: 0,
      montoCuentaCorriente: 800,
    })
  })

  it("con el CARGO revertido: no queda nada por cobrar (misma regla que get_deuda_cliente_sucursal)", () => {
    expect(aplicarCargosCuentaCorriente(conSaldo, [{ monto: 800, revertido_at: "2026-11-01T00:00:00Z" }])).toEqual({
      estadoPago: "SIN_CARGO",
      saldoPendiente: 0,
    })
  })

  it("uno revertido y uno vigente: cuenta solo el vigente", () => {
    expect(
      aplicarCargosCuentaCorriente(conSaldo, [
        { monto: 800, revertido_at: "2026-11-01T00:00:00Z" },
        { monto: 750, revertido_at: null },
      ])
    ).toMatchObject({ estadoPago: "CUENTA_CORRIENTE", montoCuentaCorriente: 750 })
  })

  it("sin cargos o sin saldo no cambia nada", () => {
    expect(aplicarCargosCuentaCorriente(conSaldo, [])).toBe(conSaldo)
    expect(aplicarCargosCuentaCorriente(conSaldo, undefined)).toBe(conSaldo)
    const pagada = resumenCobroOrden({ ...base, totalCobrado: 1000 })
    expect(aplicarCargosCuentaCorriente(pagada, [{ monto: 100, revertido_at: null }])).toBe(pagada)
  })
})
