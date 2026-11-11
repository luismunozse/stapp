/**
 * Estado derivado de una garantía (reparación o venta), por DÍA calendario en
 * la zona horaria de la organización. Sin dependencias de servidor: lo usan la
 * API, el conteo del dashboard y la página.
 *
 * La garantía cubre el día de vencimiento entero: vence "hoy" hasta las 23:59
 * de la org, y recién al día siguiente pasa a VENCIDA.
 *
 * Precedencia: ANULADA > RECLAMADA (reclamo abierto) > VENCIDA > POR_VENCER > VIGENTE.
 */
import { DEFAULT_TIMEZONE, todayInTimeZone } from "@/lib/timezone"

export type OrigenGarantia = "REPARACION" | "VENTA"
export type EstadoGarantia = "VIGENTE" | "POR_VENCER" | "VENCIDA" | "RECLAMADA" | "ANULADA"
export type TabGarantias = "por-vencer" | "reclamos" | "vigentes" | "vencidas"

export const ORIGENES_GARANTIA: readonly OrigenGarantia[] = ["REPARACION", "VENTA"]
export const TABS_GARANTIAS: readonly TabGarantias[] = ["por-vencer", "reclamos", "vigentes", "vencidas"]

/** Ventana "por vencer" por defecto (decisión 5 del doc de garantías). */
export const VENTANA_POR_VENCER_DIAS = 7
export const VENTANA_POR_VENCER_MAX = 90

export const ETIQUETA_TAB: Record<TabGarantias, string> = {
  "por-vencer": "Por vencer",
  reclamos: "Reclamos abiertos",
  vigentes: "Vigentes",
  vencidas: "Vencidas y anuladas",
}

export const ETIQUETA_ESTADO: Record<EstadoGarantia, string> = {
  VIGENTE: "Vigente",
  POR_VENCER: "Por vencer",
  VENCIDA: "Vencida",
  RECLAMADA: "Reclamada",
  ANULADA: "Anulada",
}

export const ETIQUETA_ORIGEN: Record<OrigenGarantia, string> = {
  REPARACION: "Reparación",
  VENTA: "Venta",
}

const DIA_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function aUtc(dia: string): number {
  const m = DIA_RE.exec(dia)
  if (!m) throw new Error(`Día inválido: ${dia}`)
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** Día calendario ("YYYY-MM-DD") del instante `fecha` en `zonaHoraria`. */
export function diaCalendario(fecha: Date | string, zonaHoraria: string = DEFAULT_TIMEZONE): string {
  const d = typeof fecha === "string" ? new Date(fecha) : fecha
  return todayInTimeZone(zonaHoraria, d)
}

/** `dia` + `n` días calendario. */
export function sumarDias(dia: string, n: number): string {
  return new Date(aUtc(dia) + n * 86_400_000).toISOString().slice(0, 10)
}

/** Días calendario de `desde` a `hasta` (negativo si `hasta` es anterior). */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((aUtc(hasta) - aUtc(desde)) / 86_400_000)
}

/** La ventana pedida, acotada a 0..90. Cualquier otra cosa cae al default. */
export function normalizarVentana(valor: unknown): number {
  const n = typeof valor === "number" ? valor : Number.parseInt(String(valor ?? ""), 10)
  if (!Number.isFinite(n)) return VENTANA_POR_VENCER_DIAS
  return Math.min(Math.max(Math.trunc(n), 0), VENTANA_POR_VENCER_MAX)
}

export interface EntradaEstado {
  anulada: boolean
  reclamoAbierto: boolean
  /** Día de vencimiento en la zona de la org ("YYYY-MM-DD"). */
  diaVencimiento: string
  /** Hoy en la zona de la org ("YYYY-MM-DD"). */
  hoy: string
  ventana?: number
}

export interface EstadoDerivado {
  estado: EstadoGarantia
  /** 0 = vence hoy; negativo = venció hace N días. */
  diasRestantes: number
}

export function derivarEstadoGarantia(e: EntradaEstado): EstadoDerivado {
  const ventana = e.ventana ?? VENTANA_POR_VENCER_DIAS
  const diasRestantes = diasEntre(e.hoy, e.diaVencimiento)
  if (e.anulada) return { estado: "ANULADA", diasRestantes }
  if (e.reclamoAbierto) return { estado: "RECLAMADA", diasRestantes }
  if (diasRestantes < 0) return { estado: "VENCIDA", diasRestantes }
  if (diasRestantes <= ventana) return { estado: "POR_VENCER", diasRestantes }
  return { estado: "VIGENTE", diasRestantes }
}

/** La pestaña donde cae cada estado. Las pestañas no se pisan. */
export function tabDeEstado(estado: EstadoGarantia): TabGarantias {
  switch (estado) {
    case "POR_VENCER":
      return "por-vencer"
    case "RECLAMADA":
      return "reclamos"
    case "VIGENTE":
      return "vigentes"
    default:
      return "vencidas"
  }
}

/** "Vence en 5 días", "Vence hoy", "Venció hace 3 días"… */
export function textoVencimiento(diasRestantes: number): string {
  if (diasRestantes === 0) return "Vence hoy"
  if (diasRestantes === 1) return "Vence mañana"
  if (diasRestantes > 1) return `Vence en ${diasRestantes} días`
  if (diasRestantes === -1) return "Venció ayer"
  return `Venció hace ${-diasRestantes} días`
}
