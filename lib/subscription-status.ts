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
  trial_end?: string | null | undefined
  current_period_end?: string | null | undefined
  plans?: { tipo?: PlanType | string | null; nombre?: string | null; slug?: string | null } | null
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
 * True si la suscripción es un trial sobre un plan PREMIUM (no pagado todavía)
 * y el trial NO expiró.
 */
export function isPremiumTrial(sub: SubscriptionLike | null | undefined): boolean {
  if (!sub) return false
  if (sub.plans?.tipo !== "PREMIUM" || sub.status !== "TRIALING") return false

  // Si tenemos trial_end, verificar que no haya expirado
  if (sub.trial_end) {
    return new Date(sub.trial_end) > new Date()
  }

  return true
}

/**
 * True si el trial expiró (status TRIALING pero trial_end ya pasó).
 */
export function isTrialExpired(sub: SubscriptionLike | null | undefined): boolean {
  if (!sub) return false
  if (sub.status !== "TRIALING") return false
  if (!sub.trial_end) return false
  return new Date(sub.trial_end) <= new Date()
}

export type EffectivePlanLabel = "Premium" | "Free (trial)" | "Trial expirado" | "Free" | string

/**
 * Devuelve la etiqueta a mostrar en la columna "Plan" del panel superadmin.
 *
 * - Premium pagado: nombre del plan (ej: "Profesional", "Emprendedor")
 * - Trial activo: "Plan (trial)" (ej: "Profesional (trial)")
 * - Trial expirado: "Trial expirado"
 * - Sin suscripción: "Free"
 */
export function getEffectivePlanLabel(sub: SubscriptionLike | null | undefined): EffectivePlanLabel {
  if (isEffectivelyPremium(sub)) return sub?.plans?.nombre || "Premium"
  if (isTrialExpired(sub)) return "Trial expirado"
  if (isPremiumTrial(sub)) {
    const planName = sub?.plans?.nombre || "Premium"
    return `${planName} (trial)`
  }
  return sub?.plans?.nombre || "Free"
}
