/**
 * Reglas unificadas para clasificar el "plan efectivo" de una suscripción
 * en el panel superadmin. Sin esto, /superadmin/suscripciones y
 * /superadmin/organizaciones llegan a conclusiones distintas para la misma
 * organización (por ejemplo, una org en TRIALING de un plan PREMIUM aparecía
 * como Premium en /organizaciones y como Free (trial) en /suscripciones).
 *
 * Usar SIEMPRE estas funciones en cualquier UI o filtro de plan del panel.
 */

import type { PlanType, SubscriptionStatus, PaymentProvider } from "@/types/superadmin"

export interface SubscriptionLike {
  status: SubscriptionStatus | string | null | undefined
  payment_provider: PaymentProvider | string | null | undefined
  plans?: { tipo?: PlanType | string | null; nombre?: string | null } | null
}

/**
 * Una suscripción es "Premium efectiva" sólo si:
 *  - el plan asociado es de tipo PREMIUM,
 *  - está en estado ACTIVE,
 *  - tiene un payment_provider registrado (MERCADOPAGO, REBILL o MANUAL).
 *
 * Cualquier otro caso (TRIALING, CANCELED, PAST_DUE, sin sub, plan FREE)
 * cuenta como Free a los efectos de la lista.
 */
export function isEffectivelyPremium(sub: SubscriptionLike | null | undefined): boolean {
  if (!sub) return false
  return (
    sub.plans?.tipo === "PREMIUM" &&
    sub.status === "ACTIVE" &&
    !!sub.payment_provider
  )
}

/**
 * True si la suscripción es un trial sobre un plan PREMIUM (no pagado todavía).
 * Lo mostramos como "Free (trial)" en la lista para no contarla como ingreso.
 */
export function isPremiumTrial(sub: SubscriptionLike | null | undefined): boolean {
  if (!sub) return false
  return sub.plans?.tipo === "PREMIUM" && sub.status === "TRIALING"
}

export type EffectivePlanLabel = "Premium" | "Free (trial)" | "Free" | string

/**
 * Devuelve la etiqueta a mostrar en la columna "Plan" del panel superadmin.
 * Para planes que no son PREMIUM, devuelve el nombre del plan tal cual
 * (o "Free" si la org no tiene suscripción).
 */
export function getEffectivePlanLabel(sub: SubscriptionLike | null | undefined): EffectivePlanLabel {
  if (isEffectivelyPremium(sub)) return sub?.plans?.nombre || "Premium"
  if (isPremiumTrial(sub)) return "Free (trial)"
  return sub?.plans?.nombre || "Free"
}
