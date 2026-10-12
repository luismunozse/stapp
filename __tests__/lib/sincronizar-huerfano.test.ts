import { describe, it, expect } from "vitest"
import { calcularMontoSincronizado, puedeAplicarMonto } from "@/lib/servicios/sincronizar-costo-final"

const BASE = {
  presupuestoActual: null,
  costoFinalActual: null,
  totalCobrado: 0,
  sumaAnterior: 25000,
  sumaNueva: 33000,
}

/**
 * Hasta la migración 303 la sincronización escribía SIEMPRE costo_final. Las
 * órdenes anteriores a APROBADO que quedaron de esa época tienen un costo_final
 * que la regla nueva ya no gobierna: si nadie lo limpia, queda esperando a que
 * alguien lleve la orden a REPARADO y termina siendo lo que se le cobra al
 * cliente, con el precio de una línea que quizás ya no existe.
 */
describe("calcularMontoSincronizado — costo_final huérfano", () => {
  it("marca para limpieza el costo_final que venía siguiendo a las líneas", () => {
    const r = calcularMontoSincronizado({
      ...BASE,
      estado: "EN_DIAGNOSTICO",
      costoFinalActual: 25000,
    })

    expect(r.campo).toBe("presupuesto")
    expect(r.limpiarCostoFinalHuerfano).toBe(true)
  })

  it("NO toca un costo_final que no coincide: ese número lo puso una persona", () => {
    const r = calcularMontoSincronizado({
      ...BASE,
      estado: "EN_DIAGNOSTICO",
      costoFinalActual: 90000,
    })

    expect(r.limpiarCostoFinalHuerfano).toBe(false)
  })

  it("no marca nada cuando no hay costo_final", () => {
    const r = calcularMontoSincronizado({ ...BASE, estado: "RECIBIDO", costoFinalActual: null })
    expect(r.limpiarCostoFinalHuerfano).toBe(false)
  })

  it("no aplica del lado del costo final: el presupuesto es historia de lo que el cliente aprobó", () => {
    const r = calcularMontoSincronizado({
      ...BASE,
      estado: "EN_REPARACION",
      presupuestoActual: 25000,
      costoFinalActual: 25000,
    })

    expect(r.campo).toBe("costo_final")
    expect(r.limpiarCostoFinalHuerfano).toBe(false)
  })

  it("no toca nada si la orden ya tiene cobros", () => {
    const r = calcularMontoSincronizado({
      ...BASE,
      estado: "EN_DIAGNOSTICO",
      costoFinalActual: 25000,
      totalCobrado: 5000,
    })

    expect(r.limpiarCostoFinalHuerfano).toBe(false)
  })
})

/**
 * El botón "Aplicar al total" escribe el monto a mano. Tiene que respetar los
 * mismos gates que la sincronización automática: dejar en null el costo_final
 * de una orden ya REPARADA hace desaparecer la deuda al entregar.
 */
describe("puedeAplicarMonto", () => {
  it("permite aplicar un monto mayor a cero", () => {
    expect(puedeAplicarMonto({ estado: "REPARADO", suma: 30000, totalCobrado: 0 }).ok).toBe(true)
  })

  it("rechaza vaciar el costo final de una orden ya REPARADA", () => {
    const r = puedeAplicarMonto({ estado: "REPARADO", suma: 0, totalCobrado: 0 })
    expect(r.ok).toBe(false)
    expect(r.error).toContain("sin costo")
  })

  it("rechaza vaciar el presupuesto de una orden ya PRESUPUESTADA", () => {
    expect(puedeAplicarMonto({ estado: "PRESUPUESTADO", suma: 0, totalCobrado: 0 }).ok).toBe(false)
  })

  it("deja vaciar el presupuesto de una orden que todavía no lo presentó", () => {
    expect(puedeAplicarMonto({ estado: "EN_DIAGNOSTICO", suma: 0, totalCobrado: 0 }).ok).toBe(true)
  })

  it("rechaza dejar el costo final por debajo de lo ya cobrado", () => {
    const r = puedeAplicarMonto({ estado: "EN_REPARACION", suma: 10000, totalCobrado: 40000 })
    expect(r.ok).toBe(false)
    expect(r.error).toContain("cobrado")
  })

  it("no compara contra lo cobrado del lado del presupuesto: no es lo que se cobra", () => {
    expect(puedeAplicarMonto({ estado: "RECIBIDO", suma: 10000, totalCobrado: 40000 }).ok).toBe(true)
  })

  it("rechaza aplicar en un estado terminal", () => {
    const r = puedeAplicarMonto({ estado: "ENTREGADO", suma: 10000, totalCobrado: 0 })
    expect(r.ok).toBe(false)
    expect(r.error).toContain("terminal")
  })
})
