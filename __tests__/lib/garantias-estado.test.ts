import { describe, it, expect } from "vitest"
import {
  derivarEstadoGarantia,
  diaCalendario,
  diasEntre,
  normalizarVentana,
  sumarDias,
  tabDeEstado,
  textoVencimiento,
  TABS_GARANTIAS,
  type EstadoGarantia,
} from "@/lib/garantias/estado"

const AR = "America/Argentina/Buenos_Aires"
const MX = "America/Mexico_City"
const MADRID = "Europe/Madrid"

const base = { anulada: false, reclamoAbierto: false }

describe("diaCalendario: el día de la org, no el de UTC", () => {
  it("a las 23:59 de Argentina sigue siendo el mismo día aunque en UTC ya sea el siguiente", () => {
    expect(diaCalendario("2026-11-12T02:59:59Z", AR)).toBe("2026-11-11")
    expect(diaCalendario("2026-11-12T03:00:00Z", AR)).toBe("2026-11-12")
  })

  it("respeta cada zona", () => {
    const instante = "2026-11-11T23:30:00Z"
    expect(diaCalendario(instante, AR)).toBe("2026-11-11")
    expect(diaCalendario(instante, MX)).toBe("2026-11-11")
    expect(diaCalendario(instante, MADRID)).toBe("2026-11-12")
  })
})

describe("sumarDias / diasEntre", () => {
  it("cruzan meses y años", () => {
    expect(sumarDias("2026-12-28", 7)).toBe("2027-01-04")
    expect(sumarDias("2026-03-01", -1)).toBe("2026-02-28")
    expect(diasEntre("2026-12-28", "2027-01-04")).toBe(7)
    expect(diasEntre("2026-11-11", "2026-11-08")).toBe(-3)
  })
})

describe("derivarEstadoGarantia", () => {
  const hoy = "2026-11-11"

  it.each<[string, number, EstadoGarantia]>([
    ["vence hoy", 0, "POR_VENCER"],
    ["vence dentro de la ventana", 7, "POR_VENCER"],
    ["un día después de la ventana", 8, "VIGENTE"],
    ["venció ayer", -1, "VENCIDA"],
  ])("%s", (_d, dias, estado) => {
    const r = derivarEstadoGarantia({ ...base, hoy, diaVencimiento: sumarDias(hoy, dias) })
    expect(r).toEqual({ estado, diasRestantes: dias })
  })

  it("la ventana es un parámetro", () => {
    const venc = sumarDias(hoy, 20)
    expect(derivarEstadoGarantia({ ...base, hoy, diaVencimiento: venc }).estado).toBe("VIGENTE")
    expect(derivarEstadoGarantia({ ...base, hoy, diaVencimiento: venc, ventana: 30 }).estado).toBe("POR_VENCER")
  })

  it("ANULADA gana a todo; un reclamo abierto gana a vencida", () => {
    expect(derivarEstadoGarantia({ anulada: true, reclamoAbierto: true, hoy, diaVencimiento: "2026-11-01" }).estado).toBe("ANULADA")
    expect(derivarEstadoGarantia({ anulada: false, reclamoAbierto: true, hoy, diaVencimiento: "2026-11-01" }).estado).toBe("RECLAMADA")
  })

  it("borde de medianoche en la zona de la org: cubre el día de vencimiento entero", () => {
    // Vencimiento anclado al mediodía UTC del 15/11 (addDaysInTimeZone).
    const venc = diaCalendario("2026-11-15T12:00:00Z", AR)
    const a = (instante: string) =>
      derivarEstadoGarantia({ ...base, hoy: diaCalendario(instante, AR), diaVencimiento: venc })

    // 15/11 23:59 en Argentina = 16/11 02:59 UTC: todavía vence hoy.
    expect(a("2026-11-16T02:59:00Z")).toEqual({ estado: "POR_VENCER", diasRestantes: 0 })
    // 16/11 00:00 en Argentina: ya venció.
    expect(a("2026-11-16T03:00:00Z")).toEqual({ estado: "VENCIDA", diasRestantes: -1 })
  })

  it("comparar por día y no por instante: a las 10 de la mañana del día de vencimiento sigue vigente", () => {
    // El VENCIDA "lazy" viejo comparaba instantes y la daba por vencida desde las 9:00 de Argentina.
    const venc = diaCalendario("2026-11-15T12:00:00Z", AR)
    const r = derivarEstadoGarantia({ ...base, hoy: diaCalendario("2026-11-15T13:00:00Z", AR), diaVencimiento: venc })
    expect(r.estado).toBe("POR_VENCER")
  })
})

describe("pestañas", () => {
  it("cada estado cae en exactamente una pestaña", () => {
    const estados: EstadoGarantia[] = ["VIGENTE", "POR_VENCER", "VENCIDA", "RECLAMADA", "ANULADA"]
    for (const e of estados) expect(TABS_GARANTIAS).toContain(tabDeEstado(e))
    expect(tabDeEstado("VENCIDA")).toBe("vencidas")
    expect(tabDeEstado("ANULADA")).toBe("vencidas")
  })
})

describe("textoVencimiento", () => {
  it.each([
    [0, "Vence hoy"],
    [1, "Vence mañana"],
    [5, "Vence en 5 días"],
    [-1, "Venció ayer"],
    [-12, "Venció hace 12 días"],
  ])("%i → %s", (dias, texto) => {
    expect(textoVencimiento(dias)).toBe(texto)
  })
})

describe("normalizarVentana", () => {
  it("default 7, acotada a 0..90", () => {
    expect(normalizarVentana("abc")).toBe(7)
    expect(normalizarVentana("15")).toBe(15)
    expect(normalizarVentana(-3)).toBe(0)
    expect(normalizarVentana(500)).toBe(90)
  })
})
