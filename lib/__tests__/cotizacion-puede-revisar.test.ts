import { describe, it, expect } from "vitest"
import { puedeRevisar } from "@/lib/cotizacion-puede-revisar"

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
