import { Clock, Edit, Mail, CheckCircle, XCircle } from "lucide-react"

// Single source of labels/colors for cotizacion states (list + client detail)
export const estadoConfig: Record<string, { label: string; icon: typeof Clock; color: string }> = {
  BORRADOR: { label: "Borrador", icon: Edit, color: "bg-muted text-muted-foreground" },
  ENVIADA: { label: "Enviada", icon: Mail, color: "bg-info-50 text-info-700 dark:bg-info/15 dark:text-info-500" },
  ACEPTADA: { label: "Aceptada", icon: CheckCircle, color: "bg-success-50 text-success-700 dark:bg-success/15 dark:text-success-500" },
  RECHAZADA: { label: "Rechazada", icon: XCircle, color: "bg-destructive/10 text-destructive" },
}
