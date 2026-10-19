// @vitest-environment node
import { describe, it, expect } from "vitest"
import { disponibleParaAcreditar, repartoNC } from "@/lib/notas-credito/reparto"

// Mismos casos que supabase/migrations/verify/365_probes.sql (probes 6-19).
// Si cambia la regla, cambian los dos lados (spec, Riesgos: "tablas de casos
// compartidas entre el unit TS y el probe SQL").
describe("repartoNC: primero baja la deuda, el resto se devuelve", () => {
  it.each([
    // [caso, monto, pendiente, aplicado, reembolso, pendiente después]
    ["spec: $30 sobre $40 de deuda", 30, 40, 30, 0, 10],
    ["spec: $50 sobre $40 de deuda", 50, 40, 40, 10, 0],
    ["venta pagada entera", 300, 0, 0, 300, 0],
    ["fiada entera", 500, 500, 500, 0, 0],
    ["centavos sobre una venta pagada", 66.67, 0, 0, 66.67, 0],
    ["monto cero no reparte nada", 0, 40, 0, 0, 40],
    ["un pendiente negativo (cobrado de más) cuenta como cero", 20, -5, 0, 20, 0],
  ])("%s", (_caso, monto, pendiente, aplicado, reembolso, despues) => {
    expect(repartoNC(monto, pendiente)).toEqual({ aplicado, reembolso, pendienteResultante: despues })
  })

  it("no arrastra el error de coma flotante", () => {
    expect(repartoNC(0.3, 0.1)).toEqual({ aplicado: 0.1, reembolso: 0.2, pendienteResultante: 0 })
  })
})

describe("disponibleParaAcreditar: lo facturado menos lo ya acreditado", () => {
  it.each([
    ["sin NC previas", 100, 0, 100],
    ["con una NC de $30", 100, 30, 70],
    ["centavos: 100 − 33,33", 100, 33.33, 66.67],
    ["venta agotada", 100, 100, 0],
    ["nunca negativo", 100, 120, 0],
  ])("%s", (_caso, facturado, previo, esperado) => {
    expect(disponibleParaAcreditar(facturado, previo)).toBe(esperado)
  })
})
