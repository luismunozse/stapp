import { Clock, Edit, Mail, CheckCircle, XCircle } from "lucide-react"
import type { StatusTone } from "@/lib/status-tone"

// Fuente única de etiqueta, ícono y tono por estado de presupuesto (módulo
// /cotizaciones: listados, detalle del cliente y vista pública). Se pinta con <StatusPill tone icon>.
export const estadoConfig: Record<string, { label: string; icon: typeof Clock; tone: StatusTone }> = {
  BORRADOR: { label: "Borrador", icon: Edit, tone: "neutral" },
  ENVIADA: { label: "Enviado", icon: Mail, tone: "info" },
  ACEPTADA: { label: "Aceptado", icon: CheckCircle, tone: "success" },
  RECHAZADA: { label: "Rechazado", icon: XCircle, tone: "danger" },
}
