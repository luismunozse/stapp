import { describe, it, expect } from "vitest"
import { calcularMontoSincronizado } from "@/lib/servicios/sincronizar-costo-final"

/**
 * Una orden tiene dos montos y cuál está vivo depende del estado. Antes de que
 * el cliente apruebe, el número que importa es el `presupuesto`. Después, el
 * `costo_final`, que es de donde salen el cobro y la comisión.
 */
const BASE = {
  presupuestoActual: null,
  costoFinalActual: null,
  totalCobrado: 0,
  sumaAnterior: 0,
  sumaNueva: 25000,
}

describe("calcularMontoSincronizado — elección del campo por estado", () => {
  it.each(["RECIBIDO", "EN_DIAGNOSTICO", "PRESUPUESTADO"])(
    "en %s alimenta el presupuesto",
    (estado) => {
      const r = calcularMontoSincronizado({ ...BASE, estado })
      expect(r).toEqual({ debeActualizar: true, campo: "presupuesto", nuevoMonto: 25000 })
    }
  )

  it.each(["APROBADO", "EN_REPARACION", "ESPERANDO_REPUESTO", "REPARADO"])(
    "en %s alimenta el costo final",
    (estado) => {
      const r = calcularMontoSincronizado({ ...BASE, estado })
      expect(r).toEqual({ debeActualizar: true, campo: "costo_final", nuevoMonto: 25000 })
    }
  )

  it.each([
    "ENTREGADO",
    "ENTREGADO_SIN_REPARACION",
    "ENTREGADO_SIN_COBRO",
    "CANCELADO",
    "SIN_REPARACION",
    "SIN_FALLA_DETECTADA",
  ])("en %s no toca ningún monto", (estado) => {
    const r = calcularMontoSincronizado({ ...BASE, estado })
    expect(r).toEqual({ debeActualizar: false, campo: null, nuevoMonto: null })
  })

  it("el corte está en APROBADO: ahí el presupuesto ya lo aceptó el cliente", () => {
    const presupuestado = calcularMontoSincronizado({ ...BASE, estado: "PRESUPUESTADO" })
    const aprobado = calcularMontoSincronizado({ ...BASE, estado: "APROBADO" })

    expect(presupuestado.campo).toBe("presupuesto")
    expect(aprobado.campo).toBe("costo_final")
  })
})

describe("calcularMontoSincronizado — guardas sobre el campo elegido", () => {
  it("no pisa un presupuesto editado a mano", () => {
    const r = calcularMontoSincronizado({
      ...BASE,
      estado: "RECIBIDO",
      presupuestoActual: 30000,
      sumaAnterior: 25000,
      sumaNueva: 33000,
    })
    expect(r.debeActualizar).toBe(false)
  })

  it("mira el campo vivo, no el otro: un costo final a mano no frena el presupuesto", () => {
    const r = calcularMontoSincronizado({
      ...BASE,
      estado: "RECIBIDO",
      presupuestoActual: null,
      costoFinalActual: 99999,
      sumaNueva: 25000,
    })
    expect(r).toEqual({ debeActualizar: true, campo: "presupuesto", nuevoMonto: 25000 })
  })

  it("no toca nada cuando ya hay dinero cobrado, sin importar el estado", () => {
    const r = calcularMontoSincronizado({
      ...BASE,
      estado: "EN_REPARACION",
      totalCobrado: 5000,
    })
    expect(r.debeActualizar).toBe(false)
  })

  it("deja el monto en null al borrar la última línea", () => {
    const r = calcularMontoSincronizado({
      ...BASE,
      estado: "EN_DIAGNOSTICO",
      presupuestoActual: 25000,
      sumaAnterior: 25000,
      sumaNueva: 0,
    })
    expect(r).toEqual({ debeActualizar: true, campo: "presupuesto", nuevoMonto: null })
  })

  it("no deja sin presupuesto a una orden ya PRESUPUESTADA: ese gate ya se cruzó", () => {
    const r = calcularMontoSincronizado({
      ...BASE,
      estado: "PRESUPUESTADO",
      presupuestoActual: 25000,
      sumaAnterior: 25000,
      sumaNueva: 0,
    })
    expect(r.debeActualizar).toBe(false)
  })

  it("no deja sin costo final a una orden ya REPARADA: ese gate ya se cruzó", () => {
    const r = calcularMontoSincronizado({
      ...BASE,
      estado: "REPARADO",
      costoFinalActual: 25000,
      sumaAnterior: 25000,
      sumaNueva: 0,
    })
    expect(r.debeActualizar).toBe(false)
  })
})
