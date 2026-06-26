// @vitest-environment node
import { describe, it, expect } from "vitest"
import { DEFAULT_RECEPCION_TERMINOS, parseRecepcionTerminos } from "@/lib/terminos"

describe("parseRecepcionTerminos", () => {
  it("sin custom (null/undefined/'') => términos por defecto", () => {
    expect(parseRecepcionTerminos(null)).toEqual(DEFAULT_RECEPCION_TERMINOS)
    expect(parseRecepcionTerminos(undefined)).toEqual(DEFAULT_RECEPCION_TERMINOS)
    expect(parseRecepcionTerminos("")).toEqual(DEFAULT_RECEPCION_TERMINOS)
  })

  it("custom => una línea por término, sin vacías, sin \\r", () => {
    const custom = "Garantía 30 días\r\n\r\nNo backup = no responsable\nRetiro en 30 días\n"
    expect(parseRecepcionTerminos(custom)).toEqual([
      "Garantía 30 días",
      "No backup = no responsable",
      "Retiro en 30 días",
    ])
  })

  it("el default conserva exactamente los 4 términos históricos del comprobante", () => {
    // Guardia anti-regresión: estos textos ya se imprimen en el PDF de recepción.
    // No deben cambiar para no romper la experiencia de usuarios actuales.
    expect(DEFAULT_RECEPCION_TERMINOS).toEqual([
      "1. Conserve este comprobante para retirar su equipo. El plazo de retiro es de 30 días.",
      "2. No nos hacemos responsables por datos perdidos. Realice backup antes de entregar el equipo.",
      "3. Al firmar, el cliente declara haber revisado el estado del equipo al momento de la entrega.",
      "4. El presupuesto puede variar según el diagnóstico final del equipo.",
    ])
  })
})
