import { Ban, CheckCircle2 } from "lucide-react"
import { StatusPill } from "@/components/ui/status-pill"

export function VentaEstadoBadge({ estado, className }: { estado: string; className?: string }) {
  const completada = estado === "COMPLETADA"
  return (
    <StatusPill tone={completada ? "success" : "danger"} icon={completada ? CheckCircle2 : Ban} className={className}>
      {completada ? "Completada" : "Anulada"}
    </StatusPill>
  )
}
