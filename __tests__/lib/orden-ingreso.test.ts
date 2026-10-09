import { describe, it, expect } from "vitest"
import { garantiaDesdeEntregaTexto, normalizarTrabajoARealizar } from "@/lib/orden-ingreso"

describe("normalizarTrabajoARealizar", () => {
  it("recorta espacios", () => {
    expect(normalizarTrabajoARealizar("  Cambio de pantalla  ")).toBe("Cambio de pantalla")
  })
  it("vacío, solo espacios o no-string quedan en null", () => {
    expect(normalizarTrabajoARealizar("")).toBeNull()
    expect(normalizarTrabajoARealizar("   ")).toBeNull()
    expect(normalizarTrabajoARealizar(undefined)).toBeNull()
    expect(normalizarTrabajoARealizar(null)).toBeNull()
  })
})

describe("garantiaDesdeEntregaTexto", () => {
  it("plural", () => {
    expect(garantiaDesdeEntregaTexto(30)).toBe("Garantía: 30 días desde la entrega")
  })
  it("singular", () => {
    expect(garantiaDesdeEntregaTexto(1)).toBe("Garantía: 1 día desde la entrega")
  })
  it("0, null, undefined, negativos y basura se omiten", () => {
    for (const v of [0, null, undefined, -5, NaN, "abc"]) {
      expect(garantiaDesdeEntregaTexto(v)).toBeNull()
    }
  })
  it("acepta numéricos como string (columnas numeric de PostgREST)", () => {
    expect(garantiaDesdeEntregaTexto("90")).toBe("Garantía: 90 días desde la entrega")
  })
})
