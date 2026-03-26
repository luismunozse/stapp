"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Clock, AlertTriangle, Timer } from "lucide-react"
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

function ElapsedTime({ since }: { since: string | Date }) {
  const start = new Date(since)
  const now = new Date()
  const diffMs = now.getTime() - start.getTime()
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffHours / 24)
  const remainingHours = diffHours % 24

  if (diffDays > 0) {
    return <span>{diffDays}d {remainingHours}h</span>
  }
  if (diffHours > 0) {
    return <span>{diffHours}h</span>
  }
  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  return <span>{diffMinutes}m</span>
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

  const fechaPrometidaVencida = fechaPrometida && new Date(fechaPrometida) < new Date() && estado !== "ENTREGADO" && estado !== "CANCELADO" && estado !== "SIN_REPARACION"

  const showElapsed = estado !== "ENTREGADO" && estado !== "CANCELADO" && estado !== "SIN_REPARACION"

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
              <SelectItem key={estado} value={estado}>
                {ESTADO_LABELS[estado]} (actual)
              </SelectItem>
              {transicionesPosibles.map((key) => (
                <SelectItem key={key} value={key}>
                  {ESTADO_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {fechaPrometidaVencida && (
          <div className="flex items-center gap-2 p-2 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-xs">
            <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0" />
            <span className="text-red-700 dark:text-red-400 font-medium">
              Fecha prometida vencida
            </span>
          </div>
        )}

        {showElapsed && (
          <div className="flex items-center gap-2 p-2 rounded-md bg-muted text-xs">
            <Timer className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">En este estado hace</span>
            <span className="font-medium ml-auto">
              <ElapsedTime since={fechaIngreso} />
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
