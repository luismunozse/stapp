import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { verifyCreemSignature } from "@/lib/creem"
import { beginWebhookEvent, finishWebhookEvent } from "@/lib/webhook-log"

/**
 * Webhook de Creem (cobro internacional, MoR).
 *
 * Firma: HMAC-SHA256 del raw body, hex, en el header `creem-signature`.
 *
 * Modelo de eventos (evita doble registro del primer cobro):
 *  - Producto ONETIME (ej. plan anual): el pago lo registra `checkout.completed`.
 *  - Producto RECURRING (ej. plan mensual): Creem dispara checkout.completed +
 *    subscription.active + subscription.paid para el MISMO cobro. Para no
 *    duplicar, el PAGO lo registra SOLO `subscription.paid` (cada cobro,
 *    incluido el primero). checkout.completed y subscription.active solo
 *    ACTIVAN la suscripción (sin insertar pago).
 *
 * Idempotencia: subscription_payments (provider_payment_id + payment_provider).
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
      case "subscription.active":
        // Solo activa; el pago lo registra subscription.paid.
        result = await handleSubscriptionActivate(object)
        break
      case "subscription.paid":
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
// Helpers
// ============================================================

interface PlanRow {
  id: string
  slug: string | null
}

async function resolvePlan(
  metadata: Record<string, any> | undefined,
  productId: string | null
): Promise<PlanRow | null> {
  if (metadata?.plan_id) {
    const { data } = await supabaseAdmin
      .from("plans").select("id, slug").eq("id", String(metadata.plan_id)).maybeSingle()
    if (data) return data
  }
  if (metadata?.plan_slug) {
    const { data } = await supabaseAdmin
      .from("plans").select("id, slug").eq("slug", String(metadata.plan_slug)).maybeSingle()
    if (data) return data
  }
  if (productId) {
    const { data } = await supabaseAdmin
      .from("plans")
      .select("id, slug")
      .or(`creem_product_id_monthly.eq.${productId},creem_product_id_yearly.eq.${productId}`)
      .maybeSingle()
    if (data) return data
  }
  const { data } = await supabaseAdmin
    .from("plans").select("id, slug").eq("slug", "profesional").maybeSingle()
  return data ?? null
}

function addMonths(from: Date, months: number): Date {
  const d = new Date(from)
  d.setMonth(d.getMonth() + months)
  return d
}

interface ActivationContext {
  organizationId: string
  plan: PlanRow
  billingPeriod: "MONTHLY" | "YEARLY"
  periodStart: Date
  periodEnd: Date
  creemCustomerId?: string | null
  creemSubscriptionId?: string | null
}

/** Activa/renueva la suscripción (sin insertar pago). Devuelve el subscription_id. */
async function upsertCreemSubscription(ctx: ActivationContext): Promise<string | null> {
  const { error } = await supabaseAdmin
    .from("subscriptions")
    .upsert(
      {
        organization_id: ctx.organizationId,
        plan_id: ctx.plan.id,
        status: "ACTIVE",
        billing_period: ctx.billingPeriod,
        payment_provider: "CREEM",
        creem_customer_id: ctx.creemCustomerId ?? null,
        creem_subscription_id: ctx.creemSubscriptionId ?? null,
        current_period_start: ctx.periodStart.toISOString(),
        current_period_end: ctx.periodEnd.toISOString(),
        cancel_at_period_end: false,
        canceled_at: null,
      },
      { onConflict: "organization_id" }
    )
  if (error) {
    console.error(`[creem-webhook] Error upserting subscription ${ctx.organizationId}:`, error)
    throw error
  }
  const { data } = await supabaseAdmin
    .from("subscriptions").select("id").eq("organization_id", ctx.organizationId).maybeSingle()
  return data?.id ?? null
}

/** Registra un pago (idempotente) y activa la suscripción. */
async function registerCreemPayment(
  ctx: ActivationContext,
  payment: { amount: number; currency: string; providerPaymentId: string }
): Promise<HandleResult> {
  const { data: existing } = await supabaseAdmin
    .from("subscription_payments")
    .select("id")
    .eq("provider_payment_id", payment.providerPaymentId)
    .eq("payment_provider", "CREEM")
    .maybeSingle()

  if (existing) {
    return {
      status: "SKIPPED",
      reason: "already_processed",
      organizationId: ctx.organizationId,
      subscriptionPaymentId: existing.id,
    }
  }

  const subscriptionId = await upsertCreemSubscription(ctx)

  const { data: inserted, error: payErr } = await supabaseAdmin
    .from("subscription_payments")
    .insert({
      subscription_id: subscriptionId,
      organization_id: ctx.organizationId,
      amount: payment.amount,
      currency: payment.currency,
      payment_provider: "CREEM",
      provider_payment_id: payment.providerPaymentId,
      status: "SUCCEEDED",
      paid_at: new Date().toISOString(),
      plan_name: ctx.plan.slug ?? "Premium",
      period_start: ctx.periodStart.toISOString(),
      period_end: ctx.periodEnd.toISOString(),
    })
    .select("id")
    .single()

  if (payErr) {
    // 23505 = unique_violation contra subscription_payments_provider_payment_uniq
    // (migracion 305): otra entrega concurrente del MISMO evento ya registro el
    // pago. Se reconoce en vez de devolver 500 y hacer que Creem reintente.
    //
    // DEUDA CONOCIDA: aca la suscripcion YA fue extendida por upsertCreemSubscription,
    // que corre antes del insert. La ventana es mucho mas chica que la de MercadoPago
    // (Creem no manda notificaciones multiples del mismo pago) pero existe. Cerrarla
    // pide invertir el orden, y el insert necesita el subscription_id que devuelve
    // ese upsert: es un cambio propio.
    if ((payErr as { code?: string }).code === "23505") {
      console.log(`[creem-webhook] Payment ${payment.providerPaymentId} ya registrado - skip`)
      return {
        status: "SKIPPED",
        reason: "already_processed",
      }
    }

    console.error(`[creem-webhook] Error inserting payment for org ${ctx.organizationId}:`, payErr)
    throw payErr
  }

  return {
    status: "PROCESSED",
    organizationId: ctx.organizationId,
    subscriptionPaymentId: inserted?.id ?? null,
  }
}

// ============================================================
// Handlers de eventos
// ============================================================

async function handleCheckoutCompleted(object: any): Promise<HandleResult> {
  const metadata = object?.metadata ?? {}
  const organizationId = metadata.organization_id
  if (!organizationId) return { status: "SKIPPED", reason: "missing_organization_id" }

  const order = object?.order ?? {}
  const productId = object?.product?.id ?? order?.product ?? null
  const plan = await resolvePlan(metadata, productId)
  if (!plan) return { status: "SKIPPED", reason: "plan_not_found", organizationId }

  const billingPeriod: "MONTHLY" | "YEARLY" =
    metadata.billing_period === "YEARLY" ? "YEARLY" : "MONTHLY"
  const now = new Date()
  const periodEnd = addMonths(now, billingPeriod === "YEARLY" ? 12 : 1)

  const ctx: ActivationContext = {
    organizationId,
    plan,
    billingPeriod,
    periodStart: now,
    periodEnd,
    creemCustomerId: object?.customer?.id ?? null,
    creemSubscriptionId: object?.subscription?.id ?? null,
  }

  // Recurrente: solo activamos; el pago lo registra subscription.paid (evita
  // doble registro del primer cobro). Onetime: registramos el pago acá.
  if (object?.subscription?.id) {
    await upsertCreemSubscription(ctx)
    return { status: "PROCESSED", reason: "subscription_activated", organizationId }
  }

  const amount = Number(order?.amount ?? 0) / 100
  const currency = String(order?.currency ?? "USD")
  const providerPaymentId = String(order?.id ?? object?.id ?? "")
  if (!providerPaymentId) {
    return { status: "SKIPPED", reason: "missing_order_id", organizationId }
  }
  return registerCreemPayment(ctx, { amount, currency, providerPaymentId })
}

async function handleSubscriptionActivate(object: any): Promise<HandleResult> {
  const metadata = object?.metadata ?? {}
  const organizationId = metadata.organization_id
  if (!organizationId) return { status: "SKIPPED", reason: "missing_organization_id" }

  const plan = await resolvePlan(metadata, object?.product?.id ?? null)
  if (!plan) return { status: "SKIPPED", reason: "plan_not_found", organizationId }

  const billingPeriod: "MONTHLY" | "YEARLY" =
    metadata.billing_period === "YEARLY" ? "YEARLY" : "MONTHLY"
  const now = new Date()
  const periodEndRaw = object?.current_period_end_date
  const periodEnd = periodEndRaw
    ? new Date(periodEndRaw)
    : addMonths(now, billingPeriod === "YEARLY" ? 12 : 1)

  await upsertCreemSubscription({
    organizationId,
    plan,
    billingPeriod,
    periodStart: now,
    periodEnd,
    creemCustomerId: object?.customer?.id ?? null,
    creemSubscriptionId: String(object?.id ?? "") || null,
  })
  return { status: "PROCESSED", reason: "subscription_activated", organizationId }
}

async function handleSubscriptionPaid(object: any): Promise<HandleResult> {
  const metadata = object?.metadata ?? {}
  const organizationId = metadata.organization_id
  if (!organizationId) return { status: "SKIPPED", reason: "missing_organization_id" }

  const plan = await resolvePlan(metadata, object?.product?.id ?? null)
  if (!plan) return { status: "SKIPPED", reason: "plan_not_found", organizationId }

  const billingPeriod: "MONTHLY" | "YEARLY" =
    metadata.billing_period === "YEARLY" ? "YEARLY" : "MONTHLY"
  const now = new Date()
  const periodEndRaw = object?.current_period_end_date
  const periodEnd = periodEndRaw
    ? new Date(periodEndRaw)
    : addMonths(now, billingPeriod === "YEARLY" ? 12 : 1)

  const amount = Number(object?.product?.price ?? 0) / 100
  const currency = String(object?.product?.currency ?? "USD")
  const subId = String(object?.id ?? "")
  // Una renovación por período: clave subId:periodEnd.
  const providerPaymentId = `${subId}:${periodEnd.toISOString()}`

  return registerCreemPayment(
    {
      organizationId,
      plan,
      billingPeriod,
      periodStart: now,
      periodEnd,
      creemCustomerId: object?.customer?.id ?? null,
      creemSubscriptionId: subId || null,
    },
    { amount, currency, providerPaymentId }
  )
}

async function handleSubscriptionEnded(
  object: any,
  eventType: string
): Promise<HandleResult> {
  const metadata = object?.metadata ?? {}
  const organizationId = metadata.organization_id
  if (!organizationId) return { status: "SKIPPED", reason: "missing_organization_id" }

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
