"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge, PaymentStatusBadge } from "@/components/ui/badge"
import { Eye, FileText, Calendar, ShoppingCart } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

const metodoPagoLabels: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA: "Tarjeta",
  TARJETA_DEBITO: "T. D\u00e9bito",
  TARJETA_CREDITO: "T. Cr\u00e9dito",
  MERCADOPAGO: "MercadoPago",
  OTRO: "Otro",
}

interface VentaListItem {
  id: string
  numeroVenta: number
  clienteNombre: string
  clienteTelefono?: string | null
  vendedor?: { nombre: string } | null
  items: Array<{ descripcion: string; cantidad: number }>
  total: number
  montoAbonado: number
  estadoPago: string
  metodoPago: string
  estado: string
  garantias: Array<{ id: string }>
  createdAt: string
}

interface VentaMobileCardProps {
  venta: VentaListItem
  onClick: () => void
}

export function VentaMobileCard({ venta, onClick }: VentaMobileCardProps) {
  const { formatPrice, formatDate } = useCurrency()

  return (
    <Card className="cursor-pointer active:bg-muted/50 transition-colors" onClick={onClick}>
      <CardContent className="p-4">
        {/* Header: Numero + Estado */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="font-mono font-medium text-primary text-sm">
              V{String(venta.numeroVenta).padStart(4, "0")}
            </span>
            <Badge variant={venta.estado === "COMPLETADA" ? "success" : "destructive"} className="text-[10px]">
              {venta.estado === "COMPLETADA" ? "Completada" : "Anulada"}
            </Badge>
          </div>
          <PaymentStatusBadge status={venta.estadoPago} />
        </div>

        {/* Info */}
        <div className="space-y-1.5 text-sm">
          <div>
            <div className="font-medium">{venta.clienteNombre}</div>
            {venta.clienteTelefono && (
              <div className="text-xs text-muted-foreground">{venta.clienteTelefono}</div>
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDate(venta.createdAt)}
            </div>
            <div className="flex items-center gap-1">
              <ShoppingCart className="h-3 w-3" />
              {venta.items.length} producto{venta.items.length !== 1 ? "s" : ""}
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-muted-foreground">
              {metodoPagoLabels[venta.metodoPago] || venta.metodoPago}
            </span>
            <span className="font-semibold">{formatPrice(venta.total)}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-1 mt-3 pt-2 border-t" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={(e) => {
              e.stopPropagation()
              onClick()
            }}
          >
            <Eye className="h-3.5 w-3.5 mr-1" />
            Ver
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={(e) => {
              e.stopPropagation()
              window.open(`/api/ventas/${venta.id}/pdf`, "_blank")
            }}
          >
            <FileText className="h-3.5 w-3.5 mr-1" />
            PDF
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
