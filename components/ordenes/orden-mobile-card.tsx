"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { OrderStatusBadge } from "@/components/ui/badge"
import { Eye, Trash2, Calendar, Smartphone, AlertTriangle, Clock, Printer } from "lucide-react"
import Link from "next/link"
import { useCurrency } from "@/contexts/currency-context"
import type { OrdenServicio } from "@/types"

interface OrdenMobileCardProps {
  orden: OrdenServicio
  onDelete: (e: React.MouseEvent, orden: OrdenServicio) => void
  onPrint: (e: React.MouseEvent, orden: OrdenServicio) => void
  deleting: boolean
  onClick: () => void
  hideDelete?: boolean
}

export function OrdenMobileCard({ orden, onDelete, onPrint, deleting, onClick, hideDelete }: OrdenMobileCardProps) {
  const { formatPrice, formatDate } = useCurrency()

  return (
    <Card className="cursor-pointer active:bg-muted/50 transition-colors" onClick={onClick}>
      <CardContent className="p-4">
        {/* Header: Código + Estado */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-primary font-semibold text-sm">
            {orden.codigoOrden || `#${orden.numeroOrden}`}
          </span>
          <OrderStatusBadge status={orden.estado} showIcon />
        </div>

        {/* Info */}
        <div className="space-y-1.5 text-sm">
          <div>
            <div className="font-medium">{orden.cliente?.nombre || "-"}</div>
            {orden.cliente?.telefono && (
              <div className="text-xs text-muted-foreground">{orden.cliente.telefono}</div>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Smartphone className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {orden.dispositivo}
              {orden.marca && ` \u2022 ${orden.marca}`}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
            <div className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDate(orden.fechaIngreso)}
            </div>
            {/* SLA indicator */}
            {orden.fechaPrometida && new Date(orden.fechaPrometida) < new Date() &&
             orden.estado !== "ENTREGADO" && orden.estado !== "ENTREGADO_SIN_REPARACION" && orden.estado !== "CANCELADO" && orden.estado !== "SIN_REPARACION" && (
              <div className="flex items-center gap-1 text-red-600 font-medium">
                <AlertTriangle className="h-3 w-3" />
                Vencida
              </div>
            )}
            {orden.fechaPrometida && new Date(orden.fechaPrometida) >= new Date() &&
             orden.estado !== "ENTREGADO" && orden.estado !== "ENTREGADO_SIN_REPARACION" && orden.estado !== "CANCELADO" && orden.estado !== "SIN_REPARACION" && (
              <div className="flex items-center gap-1 text-amber-600">
                <Clock className="h-3 w-3" />
                {(() => {
                  const days = Math.ceil((new Date(orden.fechaPrometida).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                  return days === 0 ? "Hoy" : days === 1 ? "Mañana" : `${days} días`
                })()}
              </div>
            )}
            {orden.presupuesto && (
              <div className="font-medium text-foreground">
                {formatPrice(orden.presupuesto)}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div role="group" className="flex items-center justify-end gap-2 mt-3 pt-2 border-t" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Link href={`/ordenes/${orden.id}`}>
            <Button variant="ghost" size="sm" className="h-10 px-3 text-sm">
              <Eye className="h-4 w-4 mr-1.5" />
              Ver detalle
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            className="h-10 w-10 text-muted-foreground hover:text-primary"
            onClick={(e) => onPrint(e, orden)}
          >
            <Printer className="h-4 w-4" />
          </Button>
          {!hideDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="h-10 w-10 text-muted-foreground hover:text-destructive"
              onClick={(e) => onDelete(e, orden)}
              disabled={deleting}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
