import { describe, it, expect } from "vitest"
import { avancesVisibles, lineasAvances, recortarAvances } from "@/lib/ordenes/avances"

describe("avancesVisibles", () => {
  it("deja solo los visibles para el cliente, con texto, del más viejo al más nuevo", () => {
    const res = avancesVisibles([
      { descripcion: "B", created_at: "2026-11-07T10:00:00Z", metadata: { visible_cliente: true } },
      { descripcion: "interno", created_at: "2026-11-06T10:00:00Z", metadata: { visible_cliente: false } },
      { descripcion: "sin metadata", created_at: "2026-11-06T10:00:00Z", metadata: null },
      { descripcion: "  ", created_at: "2026-11-06T10:00:00Z", metadata: { visible_cliente: true } },
      { descripcion: "A", created_at: "2026-11-05T10:00:00Z", metadata: { visible_cliente: true } },
    ])
    expect(res.map((a) => a.texto)).toEqual(["A", "B"])
  })
})

describe("lineasAvances", () => {
  it("antepone dd/mm en la zona del taller y junta los saltos de línea", () => {
    // 02:00 UTC del 6 es todavía el 5 en Buenos Aires.
    expect(lineasAvances([{ fecha: new Date("2026-11-06T02:00:00Z"), texto: "uno\ndos" }], "America/Argentina/Buenos_Aires")).toEqual([
      "05/11 uno dos",
    ])
  })
})

describe("recortarAvances", () => {
  it("si todo entra, no toca nada", () => {
    expect(recortarAvances([["a"], ["b", "c"]], 5)).toEqual({ lineas: ["a", "b", "c"], omitidos: 0 })
  })

  it("corta cada avance a dos renglones con …", () => {
    expect(recortarAvances([["a", "b", "c"]], 5).lineas).toEqual(["a", "b…"])
  })

  it("se queda con los más recientes y reserva un renglón para el aviso", () => {
    const { lineas, omitidos } = recortarAvances([["1"], ["2"], ["3"], ["4"]], 3)
    expect(omitidos).toBe(2)
    expect(lineas).toEqual(["+2 avances anteriores", "3", "4"])
  })
})
