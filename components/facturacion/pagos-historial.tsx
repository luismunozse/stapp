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
  costoFinancieroPorcentaje?: number | null
  costoFinancieroMonto?: number | null
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
  CUENTA_CORRIENTE: "Cuenta Corriente",
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
            {pago.recargoPorcentaje && pago.recargoPorcentaje > 0 && (
              <div className="text-xs text-muted-foreground">
                {/* `monto` es el importe base (ingreso del negocio). El recargo es interés bancario
                    que el cliente paga sobre el precio, no reduce la deuda ni es ingreso. Se computa
                    el total que paga el cliente desde monto + recargo, sin depender del ambiguo
                    `monto_original` (que difiere entre paths de venta y cobro). */}
                Total c/recargo: {formatPrice(pago.monto + pago.monto * (pago.recargoPorcentaje / 100))}
              </div>
            )}
            {pago.costoFinancieroMonto != null && pago.costoFinancieroMonto > 0 && (
              <div className="text-xs text-red-500">
                Costo terminal ({pago.costoFinancieroPorcentaje}%): -{formatPrice(pago.costoFinancieroMonto)}
                {" · "}Ingreso real: {formatPrice(pago.monto - pago.costoFinancieroMonto)}
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
