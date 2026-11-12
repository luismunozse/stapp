/**
 * Bitácora de avances de una orden: entradas de texto que el taller va sumando
 * mientras trabaja (qué se hizo, en qué estado estaba la orden).
 *
 * Se guardan en `orden_eventos` con tipo AVANCE, así no hace falta tabla nueva:
 *   descripcion            -> el texto
 *   estado_nuevo           -> el estado de la orden cuando se escribió
 *   metadata.visible_cliente -> si sale en el PDF de entrega
 *
 * El portal público de seguimiento (/api/public/ordenes/[token]/timeline) usa
 * una lista blanca de tipos y no incluye AVANCE: ningún avance sale por ahí.
 */
import { getZonedParts, DEFAULT_TIMEZONE } from "@/lib/timezone"

export const TIPO_AVANCE = "AVANCE"
export const AVANCE_MAX_CHARS = 1000

export interface AvancePDF {
  fecha: Date
  texto: string
}

interface EventoAvanceRow {
  descripcion: string | null
  created_at: string
  metadata: unknown
}

export function esVisibleCliente(metadata: unknown): boolean {
  return !!metadata && typeof metadata === "object" && (metadata as { visible_cliente?: unknown }).visible_cliente === true
}

/** Filas de orden_eventos -> avances que el cliente puede ver, del más viejo al más nuevo. */
export function avancesVisibles(rows: EventoAvanceRow[] | null | undefined): AvancePDF[] {
  return (rows ?? [])
    .filter((r) => esVisibleCliente(r.metadata) && (r.descripcion ?? "").trim() !== "")
    .map((r) => ({ fecha: new Date(r.created_at), texto: (r.descripcion ?? "").trim() }))
    .filter((a) => !Number.isNaN(a.fecha.getTime()))
    .sort((a, b) => a.fecha.getTime() - b.fecha.getTime())
}

/** "dd/mm texto" por avance, en la zona horaria del taller. */
export function lineasAvances(avances: AvancePDF[] | null | undefined, zonaHoraria?: string | null): string[] {
  const tz = zonaHoraria || DEFAULT_TIMEZONE
  return (avances ?? []).map((a) => {
    const { day, month } = getZonedParts(a.fecha, tz)
    const fecha = `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`
    return `${fecha} ${a.texto.replace(/\s+/g, " ")}`
  })
}

/**
 * Elige qué avances entran en `maxLineas` renglones de PDF. `bloques` son los
 * renglones ya cortados de cada avance, del más viejo al más nuevo. Se quedan
 * los más recientes (lo último que se hizo es lo que más le importa al
 * cliente); cada avance ocupa a lo sumo `maxPorAvance` renglones. Si alguno
 * queda afuera, el primer renglón avisa cuántos.
 */
export function recortarAvances(
  bloques: string[][],
  maxLineas: number,
  maxPorAvance = 2,
): { lineas: string[]; omitidos: number } {
  const recortados = bloques.map((b) =>
    b.length > maxPorAvance ? [...b.slice(0, maxPorAvance - 1), `${b[maxPorAvance - 1].replace(/[\s.…]+$/, "")}…`] : b,
  )
  const elegidos: string[][] = []
  let usadas = 0
  for (let i = recortados.length - 1; i >= 0; i--) {
    const quedanAfuera = i // los anteriores a este
    // Si van a quedar avances afuera hace falta un renglón para avisarlo.
    const reserva = quedanAfuera > 0 ? 1 : 0
    if (usadas + recortados[i].length + reserva > maxLineas) break
    elegidos.unshift(recortados[i])
    usadas += recortados[i].length
  }
  const omitidos = recortados.length - elegidos.length
  const lineas = elegidos.flat()
  if (omitidos > 0) lineas.unshift(`+${omitidos} avance${omitidos === 1 ? "" : "s"} anterior${omitidos === 1 ? "" : "es"}`)
  return { lineas, omitidos }
}
