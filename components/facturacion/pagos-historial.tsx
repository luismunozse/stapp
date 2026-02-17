"use client"

import { useCurrency } from "@/contexts/currency-context"

interface Pago {
  id: string
  monto: number
  fecha: string
  metodoPago: string
  referencia?: string
  notas?: string
  cuotas?: number | null
  recargoPorcentaje?: number | null
  montoOriginal?: number | null
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
  const { formatPrice, formatDate } = useCurrency()
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
          <div className="space-y-0.5">
            <div className="font-medium text-green-600">
              {formatPrice(pago.monto)}
            </div>
            <div className="text-xs text-muted-foreground">
              {formatDate(pago.fecha)} · {metodoPagoLabels[pago.metodoPago] || pago.metodoPago}
              {pago.cuotas && pago.cuotas > 1 && (
                <span> · {pago.cuotas} cuotas</span>
              )}
              {pago.recargoPorcentaje && pago.recargoPorcentaje > 0 && (
                <span> · {pago.recargoPorcentaje}% recargo</span>
              )}
            </div>
            {pago.montoOriginal && pago.recargoPorcentaje && pago.recargoPorcentaje > 0 && (
              <div className="text-xs text-muted-foreground">
                Sin recargo: {formatPrice(pago.montoOriginal)}
              </div>
            )}
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
