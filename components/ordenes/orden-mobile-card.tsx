"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { OrderStatusBadge } from "@/components/ui/badge"
import { Trash2, Calendar, Smartphone, AlertTriangle, Clock, Printer } from "lucide-react"
import Link from "next/link"
import { useCurrency } from "@/contexts/currency-context"
import { PracticaBadge } from "@/components/onboarding/practica-badge"
import { CobroResumen } from "@/components/ui/cobro-resumen"
import type { OrdenServicio } from "@/types"

interface OrdenMobileCardProps {
  orden: OrdenServicio
  onDelete: (e: React.MouseEvent, orden: OrdenServicio) => void
  onPrint: (e: React.MouseEvent, orden: OrdenServicio) => void
  deleting: boolean
  onClick: () => void
  hideDelete?: boolean
  /** Only for the onboarding practice order (ADMIN). */
  onBorrarPractica?: () => void
  borrandoPractica?: boolean
}

export function OrdenMobileCard({ orden, onDelete, onPrint, deleting, onClick, hideDelete, onBorrarPractica, borrandoPractica }: OrdenMobileCardProps) {
  const { formatPrice, formatDate } = useCurrency()

  const activa =
    orden.estado !== "ENTREGADO" && orden.estado !== "ENTREGADO_SIN_REPARACION" &&
    orden.estado !== "CANCELADO" && orden.estado !== "SIN_REPARACION"
  const vencida = !!orden.fechaPrometida && activa && new Date(orden.fechaPrometida) < new Date()
  const porVencer = !!orden.fechaPrometida && activa && new Date(orden.fechaPrometida) >= new Date()

  return (
    <Card className="cursor-pointer active:bg-muted/50 transition-colors" onClick={onClick}>
      <CardContent className="p-3">
        {/* Row 1: code · client  |  status */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <Link
                href={`/ordenes/${orden.id}`}
                onClick={(e) => e.stopPropagation()}
                className="text-primary font-semibold text-sm shrink-0"
              >
                {orden.codigoOrden || `#${orden.numeroOrden}`}
              </Link>
              <span className="truncate text-sm font-medium">{orden.cliente?.nombre || "-"}</span>
            </div>
            {orden.esPractica && <div className="mt-1"><PracticaBadge conAviso /></div>}
          </div>
          <OrderStatusBadge status={orden.estado} showIcon />
        </div>

        {/* Row 2: device  |  payment */}
        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1">
            <Smartphone className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {orden.dispositivo}
              {orden.marca && ` \u2022 ${orden.marca}`}
            </span>
          </span>
          {orden.estadoPago && (
            <CobroResumen
              estadoPago={orden.estadoPago}
              saldoPendiente={orden.saldoPendiente}
              montoEstado={orden.montoEstado}
              className="items-end shrink-0"
            />
          )}
        </div>

        {/* Row 3: date · SLA · price  |  actions */}
        <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDate(orden.fechaIngreso)}
            </span>
            {vencida && (
              <span className="flex items-center gap-1 text-red-600 font-medium">
                <AlertTriangle className="h-3 w-3" />
                Vencida
              </span>
            )}
            {porVencer && (
              <span className="flex items-center gap-1 text-amber-600">
                <Clock className="h-3 w-3" />
                {(() => {
                  const days = Math.ceil((new Date(orden.fechaPrometida!).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                  return days === 0 ? "Hoy" : days === 1 ? "Mañana" : `${days} días`
                })()}
              </span>
            )}
            {orden.presupuesto && (
              <span className="font-medium text-foreground">{formatPrice(orden.presupuesto)}</span>
            )}
          </div>

          <div role="group" className="-my-1 -mr-1 flex shrink-0 items-center" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            {orden.esPractica ? (
              onBorrarPractica && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 px-2 text-xs text-muted-foreground hover:text-destructive-text"
                  onClick={(e) => {
                    e.stopPropagation()
                    onBorrarPractica()
                  }}
                  disabled={borrandoPractica}
                >
                  <Trash2 className="h-4 w-4 mr-1" aria-hidden="true" />
                  Borrar práctica
                </Button>
              )
            ) : (
              <>
                <Button aria-label="Imprimir orden"
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 p-0 text-muted-foreground hover:text-primary"
                  onClick={(e) => onPrint(e, orden)}
                >
                  <Printer className="h-4 w-4" />
                </Button>
                {!hideDelete && (
                  <Button aria-label="Eliminar orden"
                    variant="ghost"
                    size="sm"
                    className="h-9 w-9 p-0 text-muted-foreground hover:text-destructive-text"
                    onClick={(e) => onDelete(e, orden)}
                    disabled={deleting}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
