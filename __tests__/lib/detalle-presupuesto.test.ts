import { describe, it, expect } from "vitest"
import { detallePresupuesto, TRABAJO_A_REALIZAR_MAX } from "@/lib/ordenes/trabajo-a-realizar"

describe("detallePresupuesto", () => {
  const items = [
    { nombre: "Cambio de módulo", cantidad: 1 },
    { nombre: "Vidrio templado", cantidad: 2 },
  ]

  it("usa el trabajo escrito cuando existe, aunque haya ítems", () => {
    expect(detallePresupuesto("Cambio de batería\nLimpieza", items)).toEqual(["Cambio de batería", "Limpieza"])
  })

  it("sin trabajo escrito lista los ítems, con la cantidad cuando es más de uno", () => {
    expect(detallePresupuesto(null, items)).toEqual(["Cambio de módulo", "Vidrio templado x2"])
  })

  it("sin trabajo ni ítems no devuelve nada", () => {
    expect(detallePresupuesto("", null)).toEqual([])
    expect(detallePresupuesto(null, [{ nombre: "  ", cantidad: 1 }])).toEqual([])
  })

  it("acota los ítems al tope del campo y resume el resto", () => {
    const muchos = Array.from({ length: 30 }, (_, i) => ({ nombre: `Repuesto número ${i + 1}`, cantidad: 1 }))
    const detalle = detallePresupuesto(null, muchos)
    const listados = detalle.slice(0, -1)
    expect(listados.join("").length).toBeLessThanOrEqual(TRABAJO_A_REALIZAR_MAX)
    expect(detalle.at(-1)).toBe(`+${30 - listados.length} más`)
  })
})
