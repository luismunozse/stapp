"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { OrderStatusBadge } from "@/components/ui/badge"
import { Eye, Trash2, Calendar, Smartphone } from "lucide-react"
import Link from "next/link"
import { useCurrency } from "@/contexts/currency-context"
import type { OrdenServicio } from "@/types"

interface OrdenMobileCardProps {
  orden: OrdenServicio
  onDelete: (e: React.MouseEvent, orden: OrdenServicio) => void
  deleting: boolean
  onClick: () => void
}

export function OrdenMobileCard({ orden, onDelete, deleting, onClick }: OrdenMobileCardProps) {
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
            {orden.presupuesto && (
              <div className="font-medium text-foreground">
                {formatPrice(orden.presupuesto)}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-1 mt-3 pt-2 border-t" onClick={(e) => e.stopPropagation()}>
          <Link href={`/ordenes/${orden.id}`}>
            <Button variant="ghost" size="sm" className="h-8 text-xs">
              <Eye className="h-3.5 w-3.5 mr-1" />
              Ver
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground hover:text-destructive"
            onClick={(e) => onDelete(e, orden)}
            disabled={deleting}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
