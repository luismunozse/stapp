// @vitest-environment node
import { describe, it, expect } from "vitest"
import { formatTimeValue } from "@/lib/timezone"

// Un instante UTC debe renderizar la hora de pared de la zona indicada, no la
// del entorno (que en SSR/Vercel es UTC). Este es el bug del banner de caja:
// una apertura a las 17:05 ART (=20:05 UTC) se mostraba como "20:05".
describe("formatTimeValue", () => {
  const INSTANTE = "2026-06-26T20:05:00Z" // 20:05 UTC

  // Formato es-AR = 12h ("05:05 p. m."); se asercta el prefijo hora:minuto
  // (robusto al sufijo a.m./p.m. del locale). Lo que importa es la conversión.
  it("convierte a la hora de pared de Argentina (UTC-3): 20:05Z => 05:05 pm", () => {
    expect(formatTimeValue(INSTANTE, "America/Argentina/Buenos_Aires")).toMatch(/^05:05/)
  })

  it("convierte a la hora de pared de México (UTC-6): 20:05Z => 02:05 pm", () => {
    expect(formatTimeValue(INSTANTE, "America/Mexico_City")).toMatch(/^02:05/)
  })

  it("en UTC muestra 08:05 — el valor bugueado del banner (prueba que la tz importa)", () => {
    expect(formatTimeValue(INSTANTE, "UTC")).toMatch(/^08:05/)
  })

  it("default = Argentina cuando no se pasa zona", () => {
    expect(formatTimeValue(INSTANTE)).toMatch(/^05:05/)
  })

  it("entrada vacía / inválida => string vacío", () => {
    expect(formatTimeValue(null)).toBe("")
    expect(formatTimeValue("no-es-fecha")).toBe("")
  })
})
