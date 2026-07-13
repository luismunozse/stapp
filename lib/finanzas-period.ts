/**
 * Rango de período para la sección Finanzas.
 * Fuente única de verdad para los presets y su (de)serialización,
 * de modo que Estado de Resultados, Ingresos y Gastos compartan
 * exactamente el mismo modelo de tiempo.
 */

export interface PeriodRange {
  desde: string // YYYY-MM-DD
  hasta: string // YYYY-MM-DD
}

export type PeriodPresetId =
  | "mes-actual"
  | "mes-anterior"
  | "ultimos-30"
  | "ultimos-90"
  | "este-anio"
  | "personalizado"

/** Formatea una fecha local a YYYY-MM-DD sin desfase por zona horaria. */
function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function mesActual(now: Date = new Date()): PeriodRange {
  const desde = new Date(now.getFullYear(), now.getMonth(), 1)
  const hasta = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return { desde: ymd(desde), hasta: ymd(hasta) }
}

export function mesAnterior(now: Date = new Date()): PeriodRange {
  const desde = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const hasta = new Date(now.getFullYear(), now.getMonth(), 0)
  return { desde: ymd(desde), hasta: ymd(hasta) }
}

/** Ventana inclusiva de `n` días que termina hoy (n días contando hoy). */
export function ultimosDias(n: number, now: Date = new Date()): PeriodRange {
  const hasta = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const desde = new Date(hasta)
  desde.setDate(desde.getDate() - (n - 1))
  return { desde: ymd(desde), hasta: ymd(hasta) }
}

export function esteAnio(now: Date = new Date()): PeriodRange {
  const desde = new Date(now.getFullYear(), 0, 1)
  const hasta = new Date(now.getFullYear(), 11, 31)
  return { desde: ymd(desde), hasta: ymd(hasta) }
}

export function defaultRange(now: Date = new Date()): PeriodRange {
  return mesActual(now)
}

interface PresetDef {
  id: Exclude<PeriodPresetId, "personalizado">
  label: string
  range: (now: Date) => PeriodRange
}

export const PERIOD_PRESETS: PresetDef[] = [
  { id: "mes-actual", label: "Mes actual", range: mesActual },
  { id: "mes-anterior", label: "Mes anterior", range: mesAnterior },
  { id: "ultimos-30", label: "Últimos 30 días", range: (n) => ultimosDias(30, n) },
  { id: "ultimos-90", label: "Últimos 90 días", range: (n) => ultimosDias(90, n) },
  { id: "este-anio", label: "Este año", range: esteAnio },
]

const sameRange = (a: PeriodRange, b: PeriodRange) =>
  a.desde === b.desde && a.hasta === b.hasta

/** Devuelve el preset que coincide con el rango, o "personalizado". */
export function detectPreset(range: PeriodRange, now: Date = new Date()): PeriodPresetId {
  for (const p of PERIOD_PRESETS) {
    if (sameRange(range, p.range(now))) return p.id
  }
  return "personalizado"
}

/**
 * Nombre del mes civil (`year`, `month1` en 1-12) formateado en `tz`.
 *
 * Ancla al mediodía UTC del día 1 para que el mes se renderice correcto sin
 * importar el offset horario del server. Construir el marcador con
 * `new Date(y, m, 1)` cae a medianoche LOCAL del server (UTC en Vercel) y, al
 * formatear con una tz de offset negativo, se corría al mes anterior ("julio"
 * salía "junio"). Misma convención de ancla al mediodía UTC que
 * `addDaysInTimeZone` en `lib/timezone.ts`.
 */
export function nombreMesCivil(
  year: number,
  month1: number,
  tz: string
): { corto: string; completo: string } {
  const anchor = new Date(Date.UTC(year, month1 - 1, 1, 12, 0, 0))
  return {
    corto: anchor.toLocaleDateString("es-AR", { month: "short", timeZone: tz }),
    completo: anchor.toLocaleDateString("es-AR", {
      month: "long",
      year: "numeric",
      timeZone: tz,
    }),
  }
}

/** Lee un rango de los search params de la URL; cae en el default si faltan. */
export function rangeFromParams(
  params: { desde?: string | null; hasta?: string | null },
  now: Date = new Date()
): PeriodRange {
  const { desde, hasta } = params
  if (desde && hasta) return { desde, hasta }
  return defaultRange(now)
}
