import { supabaseAdmin } from "@/lib/supabase"

/**
 * Reembolsos y contracargos de pagos de suscripción (MercadoPago, Creem, Rebill).
 *
 * Un pago que se devuelve por completo deja de pagar el período que había
 * extendido. Al recibir la reversión:
 *   1. La suscripción de la organización pasa a PAST_DUE, el estado que
 *      lib/subscriptions.ts trata como sin acceso pago (igual que un cobro
 *      fallido). Solo si sigue con el mismo proveedor del pago revertido: si la
 *      organización ya paga por otro medio, ese período no depende de este pago.
 *   2. El pago queda REFUNDED. El enum subscription_payment_status no distingue
 *      contracargo de reembolso; la diferencia queda en el motivo que el webhook
 *      guarda en webhook_events.
 *
 * Orden e idempotencia: primero la suscripción (idempotente) y después el pago,
 * con un UPDATE condicionado al estado leído. Si algo falla en el medio, el
 * reintento del proveedor vuelve a encontrar el pago sin marcar y completa. Un
 * reintento posterior encuentra el pago REFUNDED y sale con already_processed.
 *
 * Los reembolsos parciales NO pasan por acá: se loguean y no revocan.
 */

export type ReversalKind = "REFUND" | "CHARGEBACK"
export type ReversalProvider = "MERCADOPAGO" | "CREEM" | "REBILL"

export interface RegisteredSubscriptionPayment {
  id: string
  organization_id: string
  status: string
}

export interface ReversalResult {
  status: "PROCESSED" | "SKIPPED"
  reason: string
  organizationId?: string | null
  subscriptionPaymentId?: string | null
}

export const REGISTERED_PAYMENT_COLUMNS = "id, organization_id, status"

/** Busca el pago registrado por su id en el proveedor. */
export async function findSubscriptionPayment(
  provider: ReversalProvider,
  providerPaymentId: string
): Promise<RegisteredSubscriptionPayment | null> {
  const { data, error } = await supabaseAdmin
    .from("subscription_payments")
    .select(REGISTERED_PAYMENT_COLUMNS)
    .eq("payment_provider", provider)
    .eq("provider_payment_id", providerPaymentId)
    .maybeSingle()
  if (error) throw error
  return (data as RegisteredSubscriptionPayment | null) ?? null
}

export function reversalReason(kind: ReversalKind): string {
  return kind === "CHARGEBACK"
    ? "payment_charged_back_access_revoked"
    : "payment_refunded_access_revoked"
}

/** Revoca el acceso pago que dio `payment` y lo marca REFUNDED. Idempotente. */
export async function revokeSubscriptionPayment(
  payment: RegisteredSubscriptionPayment | null,
  kind: ReversalKind,
  provider: ReversalProvider
): Promise<ReversalResult> {
  if (!payment) {
    return { status: "SKIPPED", reason: "refund_payment_not_registered" }
  }

  const base = {
    organizationId: payment.organization_id,
    subscriptionPaymentId: payment.id,
  }

  if (payment.status === "REFUNDED") {
    return { status: "SKIPPED", reason: "already_processed", ...base }
  }
  if (payment.status !== "SUCCEEDED") {
    // Un pago PENDING/FAILED no extendió el período: no hay acceso que quitar.
    return {
      status: "SKIPPED",
      reason: `refund_payment_status_${payment.status.toLowerCase()}`,
      ...base,
    }
  }

  const { error: subError } = await supabaseAdmin
    .from("subscriptions")
    .update({ status: "PAST_DUE", updated_at: new Date().toISOString() })
    .eq("organization_id", payment.organization_id)
    .eq("payment_provider", provider)
    .in("status", ["ACTIVE", "TRIALING"])
  if (subError) throw subError

  const { data: marked, error: payError } = await supabaseAdmin
    .from("subscription_payments")
    .update({ status: "REFUNDED" })
    .eq("id", payment.id)
    .eq("status", "SUCCEEDED")
    .select("id")
  if (payError) throw payError

  const markedRows = Array.isArray(marked) ? marked : marked ? [marked] : []
  if (markedRows.length === 0) {
    // Otra entrega concurrente de la misma reversión lo marcó primero.
    return { status: "SKIPPED", reason: "already_processed", ...base }
  }

  const reason = reversalReason(kind)
  console.warn(
    `[subscription-reversal] ${provider} ${kind} del pago ${payment.id} ` +
      `(org ${payment.organization_id}): pago REFUNDED, suscripción PAST_DUE`
  )
  return { status: "PROCESSED", reason, ...base }
}
