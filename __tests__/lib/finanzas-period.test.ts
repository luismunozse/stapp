import { describe, it, expect } from "vitest"
import {
  mesActual,
  mesAnterior,
  ultimosDias,
  esteAnio,
  detectPreset,
  type PeriodRange,
} from "@/lib/finanzas-period"

// 15 de julio de 2026 (getMonth() === 6)
const now = new Date(2026, 6, 15)

describe("finanzas-period", () => {
  it("mesActual → primer y último día del mes en curso", () => {
    expect(mesActual(now)).toEqual({ desde: "2026-07-01", hasta: "2026-07-31" })
  })

  it("mesAnterior → mes previo completo", () => {
    expect(mesAnterior(now)).toEqual({ desde: "2026-06-01", hasta: "2026-06-30" })
  })

  it("ultimosDias(30) → ventana inclusiva de 30 días hasta hoy", () => {
    expect(ultimosDias(30, now)).toEqual({ desde: "2026-06-16", hasta: "2026-07-15" })
  })

  it("esteAnio → 1 ene a 31 dic del año en curso", () => {
    expect(esteAnio(now)).toEqual({ desde: "2026-01-01", hasta: "2026-12-31" })
  })

  it("detectPreset reconoce el preset activo y cae en personalizado", () => {
    expect(detectPreset(mesActual(now), now)).toBe("mes-actual")
    expect(detectPreset(mesAnterior(now), now)).toBe("mes-anterior")
    expect(detectPreset(ultimosDias(30, now), now)).toBe("ultimos-30")
    expect(detectPreset(esteAnio(now), now)).toBe("este-anio")
    const custom: PeriodRange = { desde: "2020-03-01", hasta: "2020-03-10" }
    expect(detectPreset(custom, now)).toBe("personalizado")
  })
})
