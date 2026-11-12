import type { StatusTone } from "@/lib/status-tone"

/**
 * Etiqueta y tono por estado de OC (se pinta con <StatusPill tone>).
 *
 * Vive acá y no en el listado porque el detalle y la ficha del proveedor pintan
 * el mismo estado: dos copias se desincronizan en cuanto alguien agrega un
 * estado nuevo.
 */
export const ESTADO_BADGE: Record<string, { label: string; tone: StatusTone }> = {
  BORRADOR: { label: "Borrador", tone: "neutral" },
  ENVIADA: { label: "Enviada", tone: "info" },
  RECIBIDA_PARCIAL: { label: "Parcial", tone: "warning" },
  RECIBIDA: { label: "Recibida", tone: "success" },
  CANCELADA: { label: "Cancelada", tone: "danger" },
}

export function estadoBadge(estado: string): { label: string; tone: StatusTone } {
  return ESTADO_BADGE[estado] || { label: estado, tone: "neutral" }
}
