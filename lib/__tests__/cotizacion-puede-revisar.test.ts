import { describe, it, expect } from "vitest"
import { puedeRevisar, puedeEditar } from "@/lib/cotizacion-puede-revisar"

describe("puedeRevisar", () => {
  it("una aceptada vigente sin convertir se puede modificar", () => {
    expect(puedeRevisar({ estado: "ACEPTADA" })).toBe(true)
  })

  it("los otros estados usan Editar, no Modificar", () => {
    for (const estado of ["BORRADOR", "ENVIADA", "VENCIDA", "RECHAZADA"]) {
      expect(puedeRevisar({ estado })).toBe(false)
    }
  })

  it("no se ofrece si ya fue reemplazada o convertida", () => {
    expect(puedeRevisar({ estado: "ACEPTADA", reemplazadaPor: "rev-1" })).toBe(false)
    expect(puedeRevisar({ estado: "ACEPTADA", ventaId: "v-1" })).toBe(false)
    expect(puedeRevisar({ estado: "ACEPTADA", convertidaAOrdenId: "o-1" })).toBe(false)
  })
})

describe("puedeEditar", () => {
  it("borrador, enviada y vencida se editan; rechazada no", () => {
    expect(puedeEditar({ estado: "BORRADOR" })).toBe(true)
    expect(puedeEditar({ estado: "ENVIADA" })).toBe(true)
    expect(puedeEditar({ estado: "VENCIDA" })).toBe(true)
    expect(puedeEditar({ estado: "RECHAZADA" })).toBe(false)
  })

  it("una aceptada se edita salvo convertida, reemplazada o del catálogo", () => {
    expect(puedeEditar({ estado: "ACEPTADA" })).toBe(true)
    expect(puedeEditar({ estado: "ACEPTADA", ventaId: "v" })).toBe(false)
    expect(puedeEditar({ estado: "ACEPTADA", convertidaAOrdenId: "o" })).toBe(false)
    expect(puedeEditar({ estado: "ACEPTADA", reemplazadaPor: "r" })).toBe(false)
    expect(puedeEditar({ estado: "ACEPTADA", origen: "CATALOGO_PUBLICO" })).toBe(false)
  })
})
