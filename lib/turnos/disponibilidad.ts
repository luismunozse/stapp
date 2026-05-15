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
 * Verifica si [inicio, fin] cae dentro de alguna franja del horario laboral.
 * Soporta turnos que cruzan día (poco común, pero seguro).
 */
export function dentroDeHorarioLaboral(
  inicio: Date,
  fin: Date | null,
  horario: HorarioLaboral | null | undefined,
): { ok: boolean; razon?: string } {
  if (!horario || Object.keys(horario).length === 0) {
    // Sin horario configurado: no validamos.
    return { ok: true }
  }

  const dia = DIAS[inicio.getDay()]
  const franjas = horario[dia] || []
  if (franjas.length === 0) {
    return { ok: false, razon: `Técnico no trabaja los ${dia}` }
  }

  const inicioMin = inicio.getHours() * 60 + inicio.getMinutes()
  const finMin = fin ? fin.getHours() * 60 + fin.getMinutes() : inicioMin + 30

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
