import { Ban, CheckCircle, Clock, MessageSquareWarning, XCircle, type LucideIcon } from "lucide-react"
import { Badge, type BadgeProps } from "@/components/ui/badge"
import { ETIQUETA_ESTADO, type EstadoGarantia } from "@/lib/garantias/estado"

/** Texto + color + ícono: el estado nunca depende solo del color. */
const PILL: Record<EstadoGarantia, { variant: BadgeProps["variant"]; icon: LucideIcon }> = {
  VIGENTE: { variant: "successSoft", icon: CheckCircle },
  POR_VENCER: { variant: "warningSoft", icon: Clock },
  RECLAMADA: { variant: "infoSoft", icon: MessageSquareWarning },
  VENCIDA: { variant: "destructiveSoft", icon: XCircle },
  ANULADA: { variant: "outline", icon: Ban },
}

/** El estado derivado de una garantía (lib/garantias/estado), igual en todas las pantallas. */
export function EstadoGarantiaPill({ estado }: { estado: EstadoGarantia }) {
  const p = PILL[estado]
  return (
    <Badge variant={p.variant} showIcon icon={p.icon} className="whitespace-nowrap">
      {ETIQUETA_ESTADO[estado]}
    </Badge>
  )
}
