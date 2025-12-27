"use client"

import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Banknote, CreditCard } from "lucide-react"

interface Pago {
  id: string
  monto: number
  metodoPago: string
  fecha: string
  numeroReferencia?: string | null
  observaciones?: string | null
}

interface PagosHistorialProps {
  pagos: Pago[]
}

const metodoPagoConfig: Record<string, { label: string; icon: typeof Banknote; color: string }> = {
  EFECTIVO: { label: "Efectivo", icon: Banknote, color: "bg-green-100 text-green-800" },
  TRANSFERENCIA: { label: "Transferencia", icon: CreditCard, color: "bg-blue-100 text-blue-800" },
}

export function PagosHistorial({ pagos }: PagosHistorialProps) {
  if (pagos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No hay pagos registrados
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {pagos.map((pago) => {
        const config = metodoPagoConfig[pago.metodoPago] || metodoPagoConfig.EFECTIVO
        const Icon = config.icon

        return (
          <div
            key={pago.id}
            className="flex items-center justify-between p-3 border rounded-lg"
          >
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-full ${config.color}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <div className="font-medium">{formatCurrency(pago.monto)}</div>
                <div className="text-sm text-muted-foreground">
                  {formatDate(pago.fecha)}
                </div>
                {pago.numeroReferencia && (
                  <div className="text-xs text-muted-foreground">
                    Ref: {pago.numeroReferencia}
                  </div>
                )}
              </div>
            </div>
            <Badge className={config.color}>{config.label}</Badge>
          </div>
        )
      })}
    </div>
  )
}
