import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { verifyLemonSqueezyWebhook } from "@/lib/lemonsqueezy"

export const dynamic = "force-dynamic"

interface LemonSqueezyWebhookPayload {
  meta: {
    event_name: string
    custom_data?: {
      organization_id?: string
      organization_name?: string
      billing_period?: string
    }
  }
  data: {
    id: string
    type: string
    attributes: {
      status: string
      customer_id: number
      variant_id: number
      product_id: number
      order_id: number
      urls?: {
        update_payment_method?: string
        customer_portal?: string
      }
      renews_at?: string
      ends_at?: string
      created_at?: string
      first_subscription_item?: {
        price_id: number
      }
      // For subscription_payment events
      subscription_id?: number
      amount?: number
      currency?: string
      invoice_url?: string
      receipt_url?: string
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    const signature = request.headers.get("x-signature") || ""

    // Verificar firma del webhook
    if (process.env.NODE_ENV === "production") {
      const isValid = verifyLemonSqueezyWebhook(rawBody, signature)
      if (!isValid) {
        console.error("Invalid LemonSqueezy webhook signature")
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
      }
    }

    const payload: LemonSqueezyWebhookPayload = JSON.parse(rawBody)
    const eventName = payload.meta.event_name

    switch (eventName) {
      case "subscription_created":
        await handleSubscriptionCreated(payload)
        break

      case "subscription_updated":
        await handleSubscriptionUpdated(payload)
        break

      case "subscription_cancelled":
        await handleSubscriptionCancelled(payload)
        break

      case "subscription_payment_success":
        await handlePaymentSuccess(payload)
        break

      case "subscription_payment_failed":
        await handlePaymentFailed(payload)
        break

      default:
        console.log(`Unhandled LemonSqueezy event: ${eventName}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error("Error processing LemonSqueezy webhook:", error)
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    )
  }
}

async function handleSubscriptionCreated(payload: LemonSqueezyWebhookPayload) {
  const organizationId = payload.meta.custom_data?.organization_id
  const billingPeriod = payload.meta.custom_data?.billing_period || "MONTHLY"
  const subscriptionId = payload.data.id

  if (!organizationId) {
    console.error("No organization_id in LemonSqueezy webhook custom_data")
    return
  }

  // Validar organización
  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("id, activo")
    .eq("id", organizationId)
    .single()

  if (!org || org.activo === false) {
    console.error(`Organization ${organizationId} not found or inactive`)
    return
  }

  // Obtener plan Premium
  const { data: premiumPlan } = await supabaseAdmin
    .from("plans")
    .select("id")
    .eq("tipo", "PREMIUM")
    .single()

  if (!premiumPlan) {
    console.error("Premium plan not found")
    return
  }

  // Calcular período
  const periodMonths = billingPeriod === "YEARLY" ? 12 : 1
  const periodEnd = new Date()
  periodEnd.setMonth(periodEnd.getMonth() + periodMonths)

  // Actualizar suscripción
  await supabaseAdmin
    .from("subscriptions")
    .upsert({
      organization_id: organizationId,
      plan_id: premiumPlan.id,
      status: "ACTIVE",
      billing_period: billingPeriod,
      payment_provider: "STRIPE", // Usamos STRIPE en DB ya que el enum ya lo soporta
      stripe_subscription_id: subscriptionId, // Guardamos el LS subscription ID aquí
      stripe_customer_id: payload.data.attributes.customer_id?.toString() || null,
      current_period_start: new Date().toISOString(),
      current_period_end: payload.data.attributes.renews_at || periodEnd.toISOString(),
    }, {
      onConflict: "organization_id",
    })

  console.log(`LemonSqueezy subscription ${subscriptionId} created for org ${organizationId}`)
}

async function handleSubscriptionUpdated(payload: LemonSqueezyWebhookPayload) {
  const subscriptionId = payload.data.id
  const status = payload.data.attributes.status

  const statusMap: Record<string, "ACTIVE" | "CANCELED" | "PAST_DUE"> = {
    active: "ACTIVE",
    past_due: "PAST_DUE",
    cancelled: "CANCELED",
    expired: "CANCELED",
    paused: "PAST_DUE",
    unpaid: "PAST_DUE",
  }

  const mappedStatus = statusMap[status] || "ACTIVE"

  await supabaseAdmin
    .from("subscriptions")
    .update({
      status: mappedStatus,
      current_period_end: payload.data.attributes.renews_at || null,
    })
    .eq("stripe_subscription_id", subscriptionId)

  console.log(`LemonSqueezy subscription ${subscriptionId} updated to ${mappedStatus}`)
}

async function handleSubscriptionCancelled(payload: LemonSqueezyWebhookPayload) {
  const subscriptionId = payload.data.id

  await supabaseAdmin
    .from("subscriptions")
    .update({
      status: "CANCELED",
      canceled_at: new Date().toISOString(),
      cancel_at_period_end: true,
    })
    .eq("stripe_subscription_id", subscriptionId)

  console.log(`LemonSqueezy subscription ${subscriptionId} cancelled`)
}

async function handlePaymentSuccess(payload: LemonSqueezyWebhookPayload) {
  const attrs = payload.data.attributes
  const subscriptionId = attrs.subscription_id?.toString()

  if (!subscriptionId) return

  // Buscar suscripción
  const { data: subscription } = await supabaseAdmin
    .from("subscriptions")
    .select("id, organization_id, billing_period")
    .eq("stripe_subscription_id", subscriptionId)
    .single()

  if (!subscription) {
    console.log(`No subscription found for LS subscription ${subscriptionId}`)
    return
  }

  // Calcular nuevo período
  const periodMonths = subscription.billing_period === "YEARLY" ? 12 : 1
  const periodEnd = new Date()
  periodEnd.setMonth(periodEnd.getMonth() + periodMonths)

  // Actualizar suscripción
  await supabaseAdmin
    .from("subscriptions")
    .update({
      status: "ACTIVE",
      current_period_start: new Date().toISOString(),
      current_period_end: periodEnd.toISOString(),
    })
    .eq("id", subscription.id)

  // Registrar pago
  await supabaseAdmin.from("subscription_payments").insert({
    subscription_id: subscription.id,
    organization_id: subscription.organization_id,
    amount: (attrs.amount || 0) / 100,
    currency: attrs.currency?.toUpperCase() || "USD",
    payment_provider: "STRIPE",
    provider_payment_id: payload.data.id,
    status: "SUCCEEDED",
    invoice_url: attrs.invoice_url || null,
    receipt_url: attrs.receipt_url || null,
    paid_at: new Date().toISOString(),
  })

  console.log(`LemonSqueezy payment success for subscription ${subscriptionId}`)
}

async function handlePaymentFailed(payload: LemonSqueezyWebhookPayload) {
  const attrs = payload.data.attributes
  const subscriptionId = attrs.subscription_id?.toString()

  if (!subscriptionId) return

  // Marcar como PAST_DUE
  await supabaseAdmin
    .from("subscriptions")
    .update({ status: "PAST_DUE" })
    .eq("stripe_subscription_id", subscriptionId)

  // Registrar pago fallido
  const { data: subscription } = await supabaseAdmin
    .from("subscriptions")
    .select("id, organization_id")
    .eq("stripe_subscription_id", subscriptionId)
    .single()

  if (subscription) {
    await supabaseAdmin.from("subscription_payments").insert({
      subscription_id: subscription.id,
      organization_id: subscription.organization_id,
      amount: (attrs.amount || 0) / 100,
      currency: attrs.currency?.toUpperCase() || "USD",
      payment_provider: "STRIPE",
      provider_payment_id: payload.data.id,
      status: "FAILED",
      paid_at: null,
    })
  }

  console.log(`LemonSqueezy payment failed for subscription ${subscriptionId}`)
}

// GET para verificación
export async function GET() {
  return NextResponse.json({ status: "ok" })
}
