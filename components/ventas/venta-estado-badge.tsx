import { Badge } from "@/components/ui/badge"

export function VentaEstadoBadge({ estado, className }: { estado: string; className?: string }) {
  const completada = estado === "COMPLETADA"
  return (
    <Badge variant={completada ? "success" : "destructive"} className={className}>
      {completada ? "Completada" : "Anulada"}
    </Badge>
  )
}
