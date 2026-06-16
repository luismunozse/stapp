import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { verifyCreemSignature } from "@/lib/creem"
import { beginWebhookEvent, finishWebhookEvent } from "@/lib/webhook-log"

/**
 * Webhook de Creem (cobro internacional, MoR).
 *
 * Firma: HMAC-SHA256 del raw body, hex, en el header `creem-signature`.
 * Eventos manejados: checkout.completed (alta/primer pago), subscription.paid
 * (renovación), subscription.canceled / subscription.expired (baja).
 *
 * La idempotencia vive en subscription_payments (provider_payment_id +
 * payment_provider='CREEM'): si el pago ya está registrado, no se duplica.
 */

interface HandleResult {
  status: "PROCESSED" | "SKIPPED"
  reason?: string
  organizationId?: string | null
  subscriptionPaymentId?: string | null
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signature = request.headers.get("creem-signature")

  let body: any = null
  try {
    body = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const valid = verifyCreemSignature(rawBody, signature)

  const log = await beginWebhookEvent({
    provider: "CREEM",
    eventType: body?.eventType ?? null,
    providerEventId: body?.id ?? null,
    payload: body,
    rawPayload: rawBody,
    headers: {
      "creem-signature": signature || "",
      "content-type": request.headers.get("content-type") || "",
    },
    signatureValid: valid,
  })

  if (!valid) {
    await finishWebhookEvent(log, {
      status: "INVALID_SIGNATURE",
      httpStatus: 401,
      errorMessage: "creem_signature_invalid",
    })
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  try {
    const eventType: string = body?.eventType ?? ""
    const object = body?.object ?? {}
    let result: HandleResult = { status: "SKIPPED", reason: `unhandled_event_${eventType}` }

    switch (eventType) {
      case "checkout.completed":
        result = await handleCheckoutCompleted(object)
        break
      case "subscription.paid":
      case "subscription.active":
        result = await handleSubscriptionPaid(object)
        break
      case "subscription.canceled":
      case "subscription.expired":
        result = await handleSubscriptionEnded(object, eventType)
        break
      default:
        console.log(`[creem-webhook] Unhandled event: ${eventType}`)
    }

    await finishWebhookEvent(log, {
      status: result.status === "PROCESSED" ? "PROCESSED" : "SKIPPED",
      httpStatus: 200,
      organizationId: result.organizationId ?? null,
      subscriptionPaymentId: result.subscriptionPaymentId ?? null,
      errorMessage: result.reason ?? null,
    })

    return NextResponse.json({ received: true, result })
  } catch (error) {
    console.error("[creem-webhook] Error procesando webhook:", error)
    await finishWebhookEvent(log, { status: "ERROR", httpStatus: 500, error })
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 })
  }
}

// ============================================================
// Resolución de plan
// ============================================================

interface PlanRow {
  id: string
  slug: string | null
}

/**
 * Resuelve el plan a partir del metadata que pusimos al crear el checkout, y si
 * falta, por el product_id de Creem (mapeado en plans.creem_product_id_*).
 */
async function resolvePlan(
  metadata: Record<string, any> | undefined,
  productId: string | null
): Promise<PlanRow | null> {
  if (metadata?.plan_id) {
    const { data } = await supabaseAdmin
      .from("plans")
      .select("id, slug")
      .eq("id", String(metadata.plan_id))
      .maybeSingle()
    if (data) return data
  }
  if (metadata?.plan_slug) {
    const { data } = await supabaseAdmin
      .from("plans")
      .select("id, slug")
      .eq("slug", String(metadata.plan_slug))
      .maybeSingle()
    if (data) return data
  }
  if (productId) {
    const { data } = await supabaseAdmin
      .from("plans")
      .select("id, slug")
      .or(
        `creem_product_id_monthly.eq.${productId},creem_product_id_yearly.eq.${productId}`
      )
      .maybeSingle()
    if (data) return data
  }
  // Fallback: plan profesional.
  const { data } = await supabaseAdmin
    .from("plans")
    .select("id, slug")
    .eq("slug", "profesional")
    .maybeSingle()
  return data ?? null
}

function addMonths(from: Date, months: number): Date {
  const d = new Date(from)
  d.setMonth(d.getMonth() + months)
  return d
}

// ============================================================
// Handlers
// ============================================================

/**
 * Registra un pago de Creem (idempotente por provider_payment_id) y activa /
 * renueva la suscripción de la org. Reusado por checkout.completed y
 * subscription.paid.
 */
async function registerCreemPayment(opts: {
  organizationId: string
  plan: PlanRow
  amount: number
  currency: string
  providerPaymentId: string
  billingPeriod: "MONTHLY" | "YEARLY"
  periodStart: Date
  periodEnd: Date
  creemCustomerId?: string | null
  creemSubscriptionId?: string | null
}): Promise<HandleResult> {
  const {
    organizationId,
    plan,
    amount,
    currency,
    providerPaymentId,
    billingPeriod,
    periodStart,
    periodEnd,
    creemCustomerId,
    creemSubscriptionId,
  } = opts

  // Idempotencia.
  const { data: existing } = await supabaseAdmin
    .from("subscription_payments")
    .select("id")
    .eq("provider_payment_id", providerPaymentId)
    .eq("payment_provider", "CREEM")
    .maybeSingle()

  if (existing) {
    return {
      status: "SKIPPED",
      reason: "already_processed",
      organizationId,
      subscriptionPaymentId: existing.id,
    }
  }

  // Suscripción existente (para enlazar el pago).
  const { data: existingSub } = await supabaseAdmin
    .from("subscriptions")
    .select("id")
    .eq("organization_id", organizationId)
    .maybeSingle()

  const { data: inserted, error: payErr } = await supabaseAdmin
    .from("subscription_payments")
    .insert({
      subscription_id: existingSub?.id ?? null,
      organization_id: organizationId,
      amount,
      currency,
      payment_provider: "CREEM",
      provider_payment_id: providerPaymentId,
      status: "SUCCEEDED",
      paid_at: new Date().toISOString(),
      plan_name: plan.slug ?? "Premium",
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
    })
    .select("id")
    .single()

  if (payErr) {
    console.error(`[creem-webhook] Error inserting payment for org ${organizationId}:`, payErr)
    throw payErr
  }

  const paymentRecordId = inserted?.id ?? null

  const { error: subErr } = await supabaseAdmin
    .from("subscriptions")
    .upsert(
      {
        organization_id: organizationId,
        plan_id: plan.id,
        status: "ACTIVE",
        billing_period: billingPeriod,
        payment_provider: "CREEM",
        creem_customer_id: creemCustomerId ?? null,
        creem_subscription_id: creemSubscriptionId ?? null,
        current_period_start: periodStart.toISOString(),
        current_period_end: periodEnd.toISOString(),
        cancel_at_period_end: false,
        canceled_at: null,
      },
      { onConflict: "organization_id" }
    )

  if (subErr) {
    console.error(`[creem-webhook] Error upserting subscription for org ${organizationId}:`, subErr)
    // El pago ya quedó registrado; dejamos la suscripción para resolución manual.
    return {
      status: "PROCESSED",
      reason: "payment_registered_subscription_activation_failed",
      organizationId,
      subscriptionPaymentId: paymentRecordId,
    }
  }

  if (!existingSub?.id && paymentRecordId) {
    const { data: newSub } = await supabaseAdmin
      .from("subscriptions")
      .select("id")
      .eq("organization_id", organizationId)
      .single()
    if (newSub) {
      await supabaseAdmin
        .from("subscription_payments")
        .update({ subscription_id: newSub.id })
        .eq("id", paymentRecordId)
    }
  }

  return {
    status: "PROCESSED",
    organizationId,
    subscriptionPaymentId: paymentRecordId,
  }
}

async function handleCheckoutCompleted(object: any): Promise<HandleResult> {
  const metadata = object?.metadata ?? {}
  const organizationId = metadata.organization_id
  if (!organizationId) {
    return { status: "SKIPPED", reason: "missing_organization_id" }
  }

  const order = object?.order ?? {}
  const productId = object?.product?.id ?? order?.product ?? null
  const plan = await resolvePlan(metadata, productId)
  if (!plan) return { status: "SKIPPED", reason: "plan_not_found", organizationId }

  const billingPeriod: "MONTHLY" | "YEARLY" =
    metadata.billing_period === "YEARLY" ? "YEARLY" : "MONTHLY"
  const now = new Date()
  const periodEnd = addMonths(now, billingPeriod === "YEARLY" ? 12 : 1)

  // amount viene en centavos.
  const amount = Number(order?.amount ?? 0) / 100
  const currency = String(order?.currency ?? "USD")
  // Idempotencia por el id de la orden de Creem.
  const providerPaymentId = String(order?.id ?? object?.id ?? "")
  if (!providerPaymentId) {
    return { status: "SKIPPED", reason: "missing_order_id", organizationId }
  }

  return registerCreemPayment({
    organizationId,
    plan,
    amount,
    currency,
    providerPaymentId,
    billingPeriod,
    periodStart: now,
    periodEnd,
    creemCustomerId: object?.customer?.id ?? null,
    creemSubscriptionId: object?.subscription?.id ?? null,
  })
}

async function handleSubscriptionPaid(object: any): Promise<HandleResult> {
  const metadata = object?.metadata ?? {}
  const organizationId = metadata.organization_id
  if (!organizationId) {
    return { status: "SKIPPED", reason: "missing_organization_id" }
  }

  const productId = object?.product?.id ?? null
  const plan = await resolvePlan(metadata, productId)
  if (!plan) return { status: "SKIPPED", reason: "plan_not_found", organizationId }

  const billingPeriod: "MONTHLY" | "YEARLY" =
    metadata.billing_period === "YEARLY" ? "YEARLY" : "MONTHLY"

  const periodEndRaw = object?.current_period_end_date
  const periodEnd = periodEndRaw ? new Date(periodEndRaw) : addMonths(new Date(), billingPeriod === "YEARLY" ? 12 : 1)
  const now = new Date()

  const amount = Number(object?.product?.price ?? 0) / 100
  const currency = String(object?.product?.currency ?? "USD")
  const subId = String(object?.id ?? "")
  // Idempotencia por suscripción + período (cada renovación es un pago distinto).
  const providerPaymentId = `${subId}:${periodEnd.toISOString()}`

  return registerCreemPayment({
    organizationId,
    plan,
    amount,
    currency,
    providerPaymentId,
    billingPeriod,
    periodStart: now,
    periodEnd,
    creemCustomerId: object?.customer?.id ?? null,
    creemSubscriptionId: subId || null,
  })
}

async function handleSubscriptionEnded(
  object: any,
  eventType: string
): Promise<HandleResult> {
  const metadata = object?.metadata ?? {}
  const organizationId = metadata.organization_id
  if (!organizationId) {
    return { status: "SKIPPED", reason: "missing_organization_id" }
  }

  const newStatus = eventType === "subscription.canceled" ? "CANCELED" : "PAST_DUE"

  const { error } = await supabaseAdmin
    .from("subscriptions")
    .update({
      status: newStatus,
      ...(eventType === "subscription.canceled"
        ? { canceled_at: new Date().toISOString() }
        : {}),
    })
    .eq("organization_id", organizationId)
    .eq("payment_provider", "CREEM")

  if (error) {
    console.error(`[creem-webhook] Error updating subscription ${organizationId}:`, error)
    throw error
  }

  return { status: "PROCESSED", reason: `subscription_${newStatus.toLowerCase()}`, organizationId }
}

// GET para verificación / health-check.
export async function GET() {
  return NextResponse.json({ status: "ok" })
}
