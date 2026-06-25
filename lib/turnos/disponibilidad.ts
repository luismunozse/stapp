import { getZonedParts, DEFAULT_TIMEZONE } from "@/lib/timezone"

export type DiaSemana = "lun" | "mar" | "mie" | "jue" | "vie" | "sab" | "dom"

export interface FranjaHoraria {
  de: string // "HH:MM"
  a: string
}

export type HorarioLaboral = Partial<Record<DiaSemana, FranjaHoraria[]>>

const DIAS: DiaSemana[] = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"]

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number)
  return h * 60 + (m || 0)
}

/**
 * Verifica si [inicio, fin] cae dentro de alguna franja del horario laboral,
 * evaluando el día de la semana y la hora en `timeZone` (org tz, DST-safe).
 * El overlap entre turnos absolutos (instantes UTC) no requiere tz y se mantiene igual.
 * Soporta turnos que cruzan día (poco común, pero seguro).
 */
export function dentroDeHorarioLaboral(
  inicio: Date,
  fin: Date | null,
  horario: HorarioLaboral | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
): { ok: boolean; razon?: string } {
  if (!horario || Object.keys(horario).length === 0) {
    // Sin horario configurado: no validamos.
    return { ok: true }
  }

  const inicioPartes = getZonedParts(inicio, timeZone)
  const dia = DIAS[inicioPartes.weekday]
  const franjas = horario[dia] || []
  if (franjas.length === 0) {
    return { ok: false, razon: `Técnico no trabaja los ${dia}` }
  }

  const inicioMin = inicioPartes.hour * 60 + inicioPartes.minute
  const finMin = fin
    ? (() => { const p = getZonedParts(fin, timeZone); return p.hour * 60 + p.minute })()
    : inicioMin + 30

  for (const f of franjas) {
    const deMin = toMinutes(f.de)
    const aMin = toMinutes(f.a)
    if (inicioMin >= deMin && finMin <= aMin) return { ok: true }
  }
  return {
    ok: false,
    razon: `Fuera del horario laboral (${franjas.map(f => `${f.de}-${f.a}`).join(", ")})`,
  }
}
