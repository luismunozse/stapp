"use client"

import { Badge, type BadgeProps } from "@/components/ui/badge"
import { useCurrency } from "@/contexts/currency-context"
import { resumenCobroOrden, type TonoCobro } from "@/lib/ordenes/resumen-cobro"

const VARIANTE: Record<TonoCobro, BadgeProps["variant"]> = {
  warning: "warningSoft",
  success: "successSoft",
  info: "infoSoft",
  neutral: "outline",
}

type Props = Parameters<typeof resumenCobroOrden>[0] & { className?: string }

/** Etiqueta de cobro de la lista de órdenes. No dibuja nada si no hay qué mostrar. */
export function CobroOrdenBadge({ className, ...orden }: Props) {
  const { formatPrice } = useCurrency()
  const r = resumenCobroOrden(orden)
  if (!r) return null
  const texto =
    r.tipo === "debe" ? `Debe ${formatPrice(r.monto!)}`
    : r.tipo === "sena" ? `Seña ${formatPrice(r.monto!)}`
    : r.tipo === "pagado" ? "Pagado"
    : "Sin cargo"
  return (
    <Badge variant={VARIANTE[r.tono]} className={className}>
      {texto}
    </Badge>
  )
}
