"use client"

import { StatusPill } from "@/components/ui/status-pill"
import { getEstadoPagoUi } from "@/lib/estado-pago-ui"
import { useCurrency } from "@/contexts/currency-context"
import { cn } from "@/lib/utils"

interface CobroResumenProps {
  /** Estado de pago/cobro, en cualquiera de sus sinónimos (ver lib/estado-pago-ui). */
  estadoPago: string | null | undefined
  /** Lo que falta cobrar. Con 0 o sin valor no se muestra "Debe". */
  saldoPendiente?: number | null
  /**
   * Monto que acompaña a la píldora cuando no hay "Debe": la seña, o la deuda
   * que ya pasó a la cuenta corriente del cliente (se cobra desde ahí).
   */
  montoEstado?: number | null
  /** `stack`: píldora arriba y saldo abajo (tabla). `inline`: en una línea (tarjeta mobile). */
  layout?: "stack" | "inline"
  className?: string
}

/**
 * Estado de cobro + saldo pendiente de una fila de lista (órdenes, ventas).
 * Sin estado no muestra nada: la celda queda con un guion.
 */
export function CobroResumen({
  estadoPago,
  saldoPendiente,
  montoEstado,
  layout = "stack",
  className,
}: CobroResumenProps) {
  const { formatPrice } = useCurrency()

  if (!estadoPago) {
    return <span className={cn("text-muted-foreground", className)}>-</span>
  }

  const ui = getEstadoPagoUi(estadoPago)
  const saldo = Number(saldoPendiente ?? 0)
  const monto = Number(montoEstado ?? 0)

  return (
    <div
      className={cn(
        "flex",
        layout === "stack" ? "flex-col items-start gap-0.5" : "flex-wrap items-center gap-x-2 gap-y-1",
        className
      )}
    >
      <StatusPill tone={ui.tone} icon={ui.icon} size="sm">
        {ui.label}
      </StatusPill>
      {saldo > 0 && (
        <span className="text-xs font-semibold text-warning-text tabular-nums">
          Debe {formatPrice(saldo)}
        </span>
      )}
      {saldo <= 0 && monto > 0 && (
        <span className="text-xs text-muted-foreground tabular-nums">{formatPrice(monto)}</span>
      )}
    </div>
  )
}
