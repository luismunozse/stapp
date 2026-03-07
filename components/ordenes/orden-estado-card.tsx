"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Clock } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import type { EstadoOrden } from "@/types"

const estadoLabels: Record<EstadoOrden, string> = {
  RECIBIDO: "Recibido",
  EN_DIAGNOSTICO: "En Diagnóstico",
  PRESUPUESTADO: "Presupuestado",
  APROBADO: "Aprobado",
  EN_REPARACION: "En Reparación",
  ESPERANDO_REPUESTO: "Esperando Repuesto",
  REPARADO: "Reparado",
  ENTREGADO: "Entregado",
  CANCELADO: "Cancelado",
  SIN_REPARACION: "Sin Reparación",
}

interface OrdenEstadoCardProps {
  estado: EstadoOrden
  fechaIngreso: string | Date
  fechaPrometida?: string | Date | null
  fechaCompletado?: string | Date | null
  updating: boolean
  onUpdateEstado: (estado: EstadoOrden) => void
}

export function OrdenEstadoCard({
  estado,
  fechaIngreso,
  fechaPrometida,
  fechaCompletado,
  updating,
  onUpdateEstado,
}: OrdenEstadoCardProps) {
  const { formatDate } = useCurrency()

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Estado
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select
          value={estado}
          onValueChange={(value) => onUpdateEstado(value as EstadoOrden)}
          disabled={updating}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(estadoLabels).map(([key, label]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Ingreso</span>
            <span>{formatDate(fechaIngreso)}</span>
          </div>
          {fechaPrometida && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Prometida</span>
              <span>{formatDate(fechaPrometida)}</span>
            </div>
          )}
          {fechaCompletado && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Completado</span>
              <span>{formatDate(fechaCompletado)}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
