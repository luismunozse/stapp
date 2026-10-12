import { describe, it, expect } from "vitest"
import { calcularCostoFinalSincronizado } from "@/lib/servicios/sincronizar-costo-final"

describe("calcularCostoFinalSincronizado", () => {
  it("autocompleta cuando la orden no tiene costo previo ni cobros", () => {
    const r = calcularCostoFinalSincronizado({
      costoFinalActual: null,
      totalCobrado: 0,
      sumaAnterior: 0,
      sumaNueva: 25000,
    })
    expect(r).toEqual({ debeActualizar: true, nuevoCostoFinal: 25000 })
  })

  it("actualiza cuando el costo actual coincide con la suma anterior", () => {
    const r = calcularCostoFinalSincronizado({
      costoFinalActual: 25000,
      totalCobrado: 0,
      sumaAnterior: 25000,
      sumaNueva: 33000,
    })
    expect(r).toEqual({ debeActualizar: true, nuevoCostoFinal: 33000 })
  })

  it("no pisa un costo editado a mano", () => {
    const r = calcularCostoFinalSincronizado({
      costoFinalActual: 30000,
      totalCobrado: 0,
      sumaAnterior: 25000,
      sumaNueva: 33000,
    })
    expect(r).toEqual({ debeActualizar: false, nuevoCostoFinal: null })
  })

  it("no toca nada si la orden ya tiene cobros", () => {
    const r = calcularCostoFinalSincronizado({
      costoFinalActual: 25000,
      totalCobrado: 10000,
      sumaAnterior: 25000,
      sumaNueva: 33000,
    })
    expect(r).toEqual({ debeActualizar: false, nuevoCostoFinal: null })
  })

  it("deja costo_final en null al eliminar la ultima linea", () => {
    const r = calcularCostoFinalSincronizado({
      costoFinalActual: 25000,
      totalCobrado: 0,
      sumaAnterior: 25000,
      sumaNueva: 0,
    })
    expect(r).toEqual({ debeActualizar: true, nuevoCostoFinal: null })
  })

  it("vuelve a autocompletar despues de haber quedado en null", () => {
    const r = calcularCostoFinalSincronizado({
      costoFinalActual: null,
      totalCobrado: 0,
      sumaAnterior: 0,
      sumaNueva: 8000,
    })
    expect(r).toEqual({ debeActualizar: true, nuevoCostoFinal: 8000 })
  })

  // Supabase devuelve DECIMAL como string. Comparar con === contra un number
  // daria siempre falso y la sincronizacion nunca se dispararia.
  it("compara correctamente cuando costo_final llega como string", () => {
    const r = calcularCostoFinalSincronizado({
      costoFinalActual: "25000.00",
      totalCobrado: "0",
      sumaAnterior: 25000,
      sumaNueva: 33000,
    })
    expect(r).toEqual({ debeActualizar: true, nuevoCostoFinal: 33000 })
  })

  it("tolera diferencias de centavos por redondeo", () => {
    const r = calcularCostoFinalSincronizado({
      costoFinalActual: "25000.00",
      totalCobrado: 0,
      sumaAnterior: 24999.999,
      sumaNueva: 33000,
    })
    expect(r.debeActualizar).toBe(true)
  })
})
