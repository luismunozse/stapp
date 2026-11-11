// @vitest-environment node
import { describe, it, expect } from "vitest"
import { computeTotales, type MovimientoUnificado } from "@/lib/caja-utils"

function mov(monto: number, opts: Partial<MovimientoUnificado> = {}): MovimientoUnificado {
  return {
    id: `m-${monto}`,
    fuente: "movimientos_caja",
    tipo: "INGRESO",
    monto,
    metodoPago: "EFECTIVO",
    fecha: "2026-11-11T12:00:00Z",
    referencia: "Movimiento",
    referenciaId: `r-${monto}`,
    observaciones: null,
    ...opts,
  }
}

describe("computeTotales: redondeo a centavos (arqueo)", () => {
  it("0.1 + 0.2 en efectivo suma 0.3 exacto, sin ruido de float", () => {
    const t = computeTotales([mov(0.1), mov(0.2)])
    expect(t.totalIngresosEfectivo).toBe(0.3)
    expect(t.totalIngresos).toBe(0.3)
    expect(t.totalDia).toBe(0.3)
    expect(t.porMetodo.EFECTIVO).toBe(0.3)
    expect(t.porTipo.INGRESO.total).toBe(0.3)
    // contado 0.3 → diferencia exacta 0 (caja cuadrada)
    expect(0.3 - t.totalIngresosEfectivo).toBe(0)
  })

  it("redondea egresos y costos financieros", () => {
    const t = computeTotales([
      mov(0.1, { esEgreso: true, tipo: "EGRESO" }),
      mov(0.2, { esEgreso: true, tipo: "EGRESO" }),
      mov(100, { metodoPago: "TARJETA_DEBITO", costoFinancieroMonto: 0.1 }),
      mov(200, { metodoPago: "TARJETA_DEBITO", costoFinancieroMonto: 0.2 }),
    ])
    expect(t.totalEgresosEfectivo).toBe(0.3)
    expect(t.totalEgresos).toBe(0.3)
    expect(t.totalCostosFinancieros).toBe(0.3)
    expect(t.totalDia).toBe(299.7)
    expect(t.ingresoReal).toBe(299.4)
  })
})
