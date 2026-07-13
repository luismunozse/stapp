import { describe, it, expect } from "vitest"
import {
  mesActual,
  mesAnterior,
  ultimosDias,
  esteAnio,
  detectPreset,
  nombreMesCivil,
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

describe("nombreMesCivil", () => {
  const tz = "America/Argentina/Buenos_Aires"

  // Regresión: en un server UTC (Vercel/CI) el label se corría al mes anterior
  // porque el marcador caía a medianoche UTC y se formateaba en tz negativa.
  it("no se corre al mes anterior aunque el server corra en UTC (offset negativo)", () => {
    expect(nombreMesCivil(2026, 7, tz).completo).toBe("julio de 2026")
    expect(nombreMesCivil(2026, 7, tz).corto).toBe("jul")
  })

  it("respeta el cruce de año en enero", () => {
    expect(nombreMesCivil(2026, 1, tz).completo).toBe("enero de 2026")
    expect(nombreMesCivil(2026, 12, tz).completo).toBe("diciembre de 2026")
  })
})
