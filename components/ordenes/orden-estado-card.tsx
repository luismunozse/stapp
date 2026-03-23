"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Clock, AlertTriangle } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { getTransicionesPosibles, ESTADO_LABELS } from "@/lib/orden-state-machine"
import type { EstadoOrden } from "@/types"

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

  const transicionesPosibles = getTransicionesPosibles(estado)
  const esTerminal = transicionesPosibles.length === 0

  // Check SLA: fecha prometida vencida
  const fechaPrometidaVencida = fechaPrometida && new Date(fechaPrometida) < new Date() && estado !== "ENTREGADO" && estado !== "CANCELADO" && estado !== "SIN_REPARACION"

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Estado
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {esTerminal ? (
          <div className="text-sm font-medium text-center py-2 px-3 rounded-md bg-muted">
            {ESTADO_LABELS[estado]}
          </div>
        ) : (
          <Select
            value={estado}
            onValueChange={(value) => onUpdateEstado(value as EstadoOrden)}
            disabled={updating}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* Estado actual siempre visible */}
              <SelectItem key={estado} value={estado}>
                {ESTADO_LABELS[estado]} (actual)
              </SelectItem>
              {/* Solo transiciones válidas */}
              {transicionesPosibles.map((key) => (
                <SelectItem key={key} value={key}>
                  {ESTADO_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* SLA: Alerta de fecha prometida vencida */}
        {fechaPrometidaVencida && (
          <div className="flex items-center gap-2 p-2 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-xs">
            <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0" />
            <span className="text-red-700 dark:text-red-400 font-medium">
              Fecha prometida vencida
            </span>
          </div>
        )}

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Ingreso</span>
            <span>{formatDate(fechaIngreso)}</span>
          </div>
          {fechaPrometida && (
            <div className="flex justify-between">
              <span className={`text-muted-foreground ${fechaPrometidaVencida ? "text-red-600 dark:text-red-400" : ""}`}>Prometida</span>
              <span className={fechaPrometidaVencida ? "text-red-600 dark:text-red-400 font-medium" : ""}>
                {formatDate(fechaPrometida)}
              </span>
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
