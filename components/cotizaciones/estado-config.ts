import { Clock, Edit, Mail, CheckCircle, XCircle } from "lucide-react"
import type { StatusTone } from "@/lib/status-tone"

// Fuente única de etiqueta, ícono y tono por estado de cotización (listados,
// detalle del cliente y vista pública). Se pinta con <StatusPill tone icon>.
export const estadoConfig: Record<string, { label: string; icon: typeof Clock; tone: StatusTone }> = {
  BORRADOR: { label: "Borrador", icon: Edit, tone: "neutral" },
  ENVIADA: { label: "Enviada", icon: Mail, tone: "info" },
  ACEPTADA: { label: "Aceptada", icon: CheckCircle, tone: "success" },
  RECHAZADA: { label: "Rechazada", icon: XCircle, tone: "danger" },
}
