import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const { event, data } = body

    switch (event) {
      case "payment.created":
      case "payment.updated":
        await handlePaymentEvent(data)
        break

      case "subscription.created":
      case "subscription.updated":
        await handleSubscriptionEvent(data)
        break

      default:
        console.log(`Unhandled Rebill event: ${event}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error("Error processing Rebill webhook:", error)
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    )
  }
}

async function handlePaymentEvent(data: any) {
  const payment = data
  const metadata = payment.metadata || {}
  const organizationId = metadata.organization_id

  if (!organizationId) {
    console.error("No organization_id in Rebill payment metadata")
    return
  }

  // Validar que la organización exista
  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("id, activo")
    .eq("id", organizationId)
    .single()

  if (!org || org.activo === false) {
    console.error(`Organization ${organizationId} not found or inactive`)
    return
  }

  // Solo procesar pagos aprobados
  if (payment.status !== "approved") {
    console.log(`Rebill payment ${payment.id} status: ${payment.status}`)

    // Si el pago falló, actualizar suscripción a PAST_DUE
    if (payment.status === "rejected" || payment.status === "failed") {
      await supabaseAdmin
        .from("subscriptions")
        .update({ status: "PAST_DUE" })
        .eq("organization_id", organizationId)
    }
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
  const billingPeriod = metadata.billing_period || "MONTHLY"
  const periodMonths = billingPeriod === "YEARLY" ? 12 : 1
  const periodEnd = new Date()
  periodEnd.setMonth(periodEnd.getMonth() + periodMonths)

  // Actualizar o crear suscripción
  await supabaseAdmin
    .from("subscriptions")
    .upsert(
      {
        organization_id: organizationId,
        plan_id: premiumPlan.id,
        status: "ACTIVE",
        billing_period: billingPeriod,
        payment_provider: "REBILL",
        rebill_subscription_id: payment.subscriptionId || null,
        rebill_customer_id: payment.customerId || null,
        current_period_start: new Date().toISOString(),
        current_period_end: periodEnd.toISOString(),
      },
      {
        onConflict: "organization_id",
      }
    )

  // Obtener suscripción para guardar pago
  const { data: subscription } = await supabaseAdmin
    .from("subscriptions")
    .select("id")
    .eq("organization_id", organizationId)
    .single()

  if (subscription) {
    await supabaseAdmin.from("subscription_payments").insert({
      subscription_id: subscription.id,
      organization_id: organizationId,
      amount: payment.amount || payment.prices?.[0]?.amount,
      currency: payment.currency || "USD",
      payment_provider: "REBILL",
      provider_payment_id: payment.id,
      status: "SUCCEEDED",
      paid_at: new Date().toISOString(),
    })
  }

  console.log(`Rebill payment ${payment.id} processed for org ${organizationId}`)
}

async function handleSubscriptionEvent(data: any) {
  const subscription = data
  const metadata = subscription.metadata || {}
  const organizationId = metadata.organization_id

  if (!organizationId) {
    console.error("No organization_id in Rebill subscription metadata")
    return
  }

  // Mapear estado de Rebill a nuestro sistema
  const statusMap: Record<string, "ACTIVE" | "CANCELED" | "PAST_DUE"> = {
    active: "ACTIVE",
    paused: "PAST_DUE",
    cancelled: "CANCELED",
    delinquent: "PAST_DUE",
  }

  const status = statusMap[subscription.status] || "ACTIVE"

  await supabaseAdmin
    .from("subscriptions")
    .update({
      status,
      rebill_subscription_id: subscription.id,
    })
    .eq("organization_id", organizationId)

  console.log(`Rebill subscription ${subscription.id} updated to ${status}`)
}

// GET para verificación de webhook
export async function GET() {
  return NextResponse.json({ status: "ok" })
}
