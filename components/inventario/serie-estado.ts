import type { StatusTone } from "@/lib/status-tone"

export type EstadoSerie = "DISPONIBLE" | "RESERVADO" | "VENDIDO" | "GARANTIA_ACTIVA" | "DEVUELTO" | "BLOQUEADO"

/** Etiqueta y tono por estado de número de serie (búsqueda global y diálogo del artículo). */
export const SERIE_ESTADO: Record<EstadoSerie, { label: string; tone: StatusTone }> = {
  DISPONIBLE: { label: "Disponible", tone: "success" },
  RESERVADO: { label: "Reservado", tone: "info" },
  VENDIDO: { label: "Vendido", tone: "muted" },
  GARANTIA_ACTIVA: { label: "Garantía activa", tone: "warning" },
  DEVUELTO: { label: "Devuelto", tone: "danger" },
  BLOQUEADO: { label: "Bloqueado", tone: "danger" },
}

export function serieEstado(estado: string): { label: string; tone: StatusTone } {
  return SERIE_ESTADO[estado as EstadoSerie] ?? { label: estado, tone: "neutral" }
}
