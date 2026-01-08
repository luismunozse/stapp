"use client"

import { formatDate, formatCurrency } from "@/lib/utils"

interface Pago {
  id: string
  monto: number
  fecha: string
  metodoPago: string
  referencia?: string
  notas?: string
}

interface PagosHistorialProps {
  pagos: Pago[]
}

const metodoPagoLabels: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA_DEBITO: "Tarjeta Débito",
  TARJETA_CREDITO: "Tarjeta Crédito",
  MERCADOPAGO: "MercadoPago",
  OTRO: "Otro",
}

export function PagosHistorial({ pagos }: PagosHistorialProps) {
  if (!pagos || pagos.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-4">
        No hay pagos registrados
      </div>
    )
  }

  return (
    <div className="space-y-2 mt-2">
      {pagos.map((pago) => (
        <div
          key={pago.id}
          className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
        >
          <div>
            <div className="font-medium text-green-600">
              {formatCurrency(pago.monto)}
            </div>
            <div className="text-xs text-muted-foreground">
              {formatDate(pago.fecha)} - {metodoPagoLabels[pago.metodoPago] || pago.metodoPago}
            </div>
            {pago.referencia && (
              <div className="text-xs text-muted-foreground">
                Ref: {pago.referencia}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
