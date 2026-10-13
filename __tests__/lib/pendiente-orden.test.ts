import { describe, it, expect } from "vitest"
import {
  pendienteOrden,
  aplicadoNotasCreditoDeOrden,
  NOTAS_CREDITO_APLICADO_EMBED,
} from "@/lib/ordenes/pendiente"

// Mismos casos que supabase/migrations/verify/360_probes.sql: el helper TS y
// pendiente_orden() tienen que dar lo mismo.
describe("pendienteOrden", () => {
  it.each([
    // costoFinal, descuentoCobro, totalCobrado, aplicadoNotasCredito, esperado
    [1000, 0, 400, 0, 600],
    [1000, 0, 400, 600, 0],
    [1000, 0, 0, 200, 800],
    [1000, 0, 0, 0, 1000],
    [500, 100, 400, 0, 0],
    [0, 0, 0, 0, 0],
    [100, 0, 150, 0, -50],
  ])("costo %d - descuento %d - cobrado %d - NC %d = %d", (costoFinal, descuentoCobro, totalCobrado, aplicadoNotasCredito, esperado) => {
    expect(pendienteOrden({ costoFinal, descuentoCobro, totalCobrado, aplicadoNotasCredito })).toBe(esperado)
  })

  it("sin NC da exactamente la resta que reemplaza, en el mismo orden (sin redondeo)", () => {
    const casos: Array<[number, number, number]> = [[100.1, 0, 50.05], [99.99, 10.01, 0.3], [0.3, 0.1, 0.2]]
    for (const [c, d, t] of casos) {
      expect(pendienteOrden({ costoFinal: c, descuentoCobro: d, totalCobrado: t, aplicadoNotasCredito: 0 })).toBe(c - d - t)
    }
  })
})

describe("aplicadoNotasCreditoDeOrden", () => {
  it("suma lo aplicado a deuda de las NC activas, venga como string o como número", () => {
    expect(aplicadoNotasCreditoDeOrden({
      notas_credito: [
        { monto_aplicado_deuda: "300", anulada: false },
        { monto_aplicado_deuda: 150.5, anulada: false },
      ],
    })).toBe(450.5)
  })

  it("ignora las anuladas", () => {
    expect(aplicadoNotasCreditoDeOrden({
      notas_credito: [
        { monto_aplicado_deuda: "300", anulada: true },
        { monto_aplicado_deuda: "100", anulada: false },
      ],
    })).toBe(100)
  })

  it("sin embed, con embed vacío o con nulos da 0", () => {
    expect(aplicadoNotasCreditoDeOrden(undefined)).toBe(0)
    expect(aplicadoNotasCreditoDeOrden(null)).toBe(0)
    expect(aplicadoNotasCreditoDeOrden({})).toBe(0)
    expect(aplicadoNotasCreditoDeOrden({ notas_credito: null })).toBe(0)
    expect(aplicadoNotasCreditoDeOrden({ notas_credito: [{ monto_aplicado_deuda: null, anulada: null }] })).toBe(0)
  })

  it("redondea a centavos", () => {
    expect(aplicadoNotasCreditoDeOrden({
      notas_credito: [
        { monto_aplicado_deuda: "0.10", anulada: false },
        { monto_aplicado_deuda: "0.20", anulada: false },
      ],
    })).toBe(0.3)
  })
})

describe("NOTAS_CREDITO_APLICADO_EMBED", () => {
  it("pide las dos columnas que usa el helper", () => {
    expect(NOTAS_CREDITO_APLICADO_EMBED).toBe("notas_credito (monto_aplicado_deuda, anulada)")
  })
})
