/**
 * Fuente única de cómo se ve un estado de cobro/pago: etiqueta, ícono y tono de
 * la píldora. La usan las listas de órdenes y ventas, el detalle de la venta,
 * facturación y la ficha del cliente (vía `PaymentStatusBadge`).
 *
 * La base guarda el mismo concepto con varios nombres según la tabla
 * (ventas: PAGADO / PAGADO_PARCIAL / PENDIENTE; órdenes: COBRADO / PARCIAL /
 * PENDIENTE). Acá se reducen a un solo juego de etiquetas, así el mostrador lee
 * "Pagado" o "Pago parcial" en todas las pantallas y no "Cobrado" en una y
 * "Pagado" en otra.
 */
import { Ban, CheckCircle2, CircleDashed, Clock, HandCoins, Wallet, type LucideIcon } from "lucide-react"
import type { StatusTone } from "@/lib/status-tone"

export const ESTADOS_PAGO = ["SIN_COBRAR", "SENA", "PARCIAL", "PAGADO", "SIN_CARGO", "ANULADA"] as const
export type EstadoPagoNormalizado = (typeof ESTADOS_PAGO)[number]

export interface EstadoPagoUi {
  label: string
  icon: LucideIcon
  tone: StatusTone
}

export const ESTADO_PAGO_UI: Record<EstadoPagoNormalizado, EstadoPagoUi> = {
  SIN_COBRAR: { label: "Sin cobrar", icon: Clock, tone: "warning" },
  // Orden sin precio final todavía, pero con plata a cuenta.
  SENA: { label: "Con seña", icon: Wallet, tone: "info" },
  PARCIAL: { label: "Pago parcial", icon: CircleDashed, tone: "info" },
  PAGADO: { label: "Pagado", icon: CheckCircle2, tone: "success" },
  SIN_CARGO: { label: "Sin cargo", icon: HandCoins, tone: "muted" },
  ANULADA: { label: "Anulada", icon: Ban, tone: "danger" },
}

/** Sinónimos que hay en la base (y en la API) → estado normalizado. */
const SINONIMOS: Record<string, EstadoPagoNormalizado> = {
  PENDIENTE: "SIN_COBRAR",
  SIN_COBRAR: "SIN_COBRAR",
  SENA: "SENA",
  PARCIAL: "PARCIAL",
  PAGADO_PARCIAL: "PARCIAL",
  PAGADO: "PAGADO",
  COBRADO: "PAGADO",
  SIN_CARGO: "SIN_CARGO",
  ANULADA: "ANULADA",
  ANULADO: "ANULADA",
}

/** Normaliza un estado de pago/cobro. Un valor desconocido da `null`. */
export function normalizarEstadoPago(status: string | null | undefined): EstadoPagoNormalizado | null {
  if (!status) return null
  return SINONIMOS[status.trim().toUpperCase()] ?? null
}

/**
 * Etiqueta y tono de un estado de pago. Un valor desconocido se muestra tal
 * cual, en tono neutro: mejor ver el código que una píldora vacía.
 */
export function getEstadoPagoUi(status: string | null | undefined): EstadoPagoUi {
  const normalizado = normalizarEstadoPago(status)
  if (normalizado) return ESTADO_PAGO_UI[normalizado]
  return { label: status ?? "", icon: CircleDashed, tone: "neutral" }
}
