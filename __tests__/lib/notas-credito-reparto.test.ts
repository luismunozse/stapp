// @vitest-environment node
import { describe, it, expect } from "vitest"
import { disponibleParaAcreditar, repartoNC, round2 } from "@/lib/notas-credito/reparto"

// La base redondea con ROUND(x, 2) sobre el decimal: la mitad se aleja del cero.
// En binario 2.135 es 2.13499999…, así que un Math.round(x * 100) daría 2.13 y
// el diálogo mostraría un centavo distinto del que guarda la base.
describe("round2: igual que ROUND(x, 2) de SQL", () => {
  it.each([
    [2.135, 2.14],
    [2.175, 2.18],
    [4.015, 4.02],
    [1.005, 1.01],
    [-2.135, -2.14],
    [-4.015, -4.02],
    [66.67, 66.67],
    [0.1 + 0.2, 0.3],
    [100, 100],
  ])("round2(%s) = %s", (n, esperado) => {
    expect(round2(n)).toBe(esperado)
  })

  it("no devuelve -0", () => {
    expect(Object.is(round2(-0.001), 0)).toBe(true)
  })

  it("un número enorme (sin centavos representables) vuelve igual, no NaN", () => {
    expect(round2(1e21)).toBe(1e21)
    expect(round2(-1e21)).toBe(-1e21)
  })
})

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
