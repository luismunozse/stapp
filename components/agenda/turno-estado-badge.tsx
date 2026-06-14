import type { EstadoTurno } from "@/types"
import { TURNO_ESTADO_STYLES, ESTADO_LABELS } from "@/lib/turno-colors"

interface TurnoEstadoBadgeProps {
  estado: EstadoTurno
}

export function TurnoEstadoBadge({ estado }: TurnoEstadoBadgeProps) {
  return (
    <span className={`text-xs font-medium px-2 py-1 rounded-full ${TURNO_ESTADO_STYLES[estado].badge}`}>
      {ESTADO_LABELS[estado]}
    </span>
  )
}
