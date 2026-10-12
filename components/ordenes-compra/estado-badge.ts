export type EstadoBadgeVariant = "default" | "secondary" | "outline" | "destructive"

/**
 * Etiqueta y color por estado de OC.
 *
 * Vive acá y no en el listado porque el detalle pinta el mismo estado: dos
 * copias se desincronizan en cuanto alguien agrega un estado nuevo.
 */
export const ESTADO_BADGE: Record<string, { label: string; variant: EstadoBadgeVariant }> = {
  BORRADOR: { label: "Borrador", variant: "secondary" },
  ENVIADA: { label: "Enviada", variant: "default" },
  RECIBIDA_PARCIAL: { label: "Parcial", variant: "outline" },
  RECIBIDA: { label: "Recibida", variant: "default" },
  CANCELADA: { label: "Cancelada", variant: "destructive" },
}

export function estadoBadge(estado: string) {
  return ESTADO_BADGE[estado] || { label: estado, variant: "secondary" as const }
}
