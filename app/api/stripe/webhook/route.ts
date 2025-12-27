import { NextRequest, NextResponse } from "next/server"
import { constructWebhookEvent } from "@/lib/stripe"
import { supabaseAdmin } from "@/lib/supabase"
import Stripe from "stripe"

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get("stripe-signature")

  if (!signature) {
    return NextResponse.json({ error: "No signature" }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = constructWebhookEvent(body, signature)
  } catch (err) {
    console.error("Webhook signature verification failed:", err)
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
        break

      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionUpdate(event.data.object as Stripe.Subscription)
        break

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
        break

      case "invoice.payment_succeeded":
        await handlePaymentSucceeded(event.data.object as Stripe.Invoice)
        break

      case "invoice.payment_failed":
        await handlePaymentFailed(event.data.object as Stripe.Invoice)
        break

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error("Error processing webhook:", error)
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    )
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const organizationId = session.metadata?.organization_id
  if (!organizationId) {
    console.error("No organization_id in checkout session metadata")
    return
  }

  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("id, activo")
    .eq("id", organizationId)
    .single()

  if (!org || org.activo === false) {
    console.error(`Organization ${organizationId} not found or inactive`)
    return
  }

  const subscriptionId = session.subscription as string
  const customerId = session.customer as string

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

  // Actualizar o crear suscripción
  await supabaseAdmin
    .from("subscriptions")
    .upsert({
      organization_id: organizationId,
      plan_id: premiumPlan.id,
      status: "ACTIVE",
      payment_provider: "STRIPE",
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: customerId,
      current_period_start: new Date().toISOString(),
    }, {
      onConflict: "organization_id",
    })

  console.log(`Subscription created for organization ${organizationId}`)
}

async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  let organizationId = subscription.metadata?.organization_id
  if (!organizationId) {
    // Buscar por stripe_subscription_id
    const { data: existingSub } = await supabaseAdmin
      .from("subscriptions")
      .select("organization_id")
      .eq("stripe_subscription_id", subscription.id)
      .single()

    if (!existingSub) {
      console.log("Subscription not found in database:", subscription.id)
      return
    }
    organizationId = existingSub.organization_id
  }

  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("id, activo")
    .eq("id", organizationId)
    .single()

  if (!org || org.activo === false) {
    console.error(`Organization ${organizationId} not found or inactive`)
    return
  }

  const status = mapStripeStatus(subscription.status)
  const cancelAtPeriodEnd = subscription.cancel_at_period_end

  // Cast to any to handle Stripe type variations
  const sub = subscription as any

  await supabaseAdmin
    .from("subscriptions")
    .update({
      status,
      cancel_at_period_end: cancelAtPeriodEnd,
      current_period_start: sub.current_period_start
        ? new Date(sub.current_period_start * 1000).toISOString()
        : null,
      current_period_end: sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null,
      canceled_at: sub.canceled_at
        ? new Date(sub.canceled_at * 1000).toISOString()
        : null,
    })
    .eq("stripe_subscription_id", subscription.id)

  console.log(`Subscription ${subscription.id} updated to ${status}`)
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const { data: existingSub } = await supabaseAdmin
    .from("subscriptions")
    .select("organization_id")
    .eq("stripe_subscription_id", subscription.id)
    .single()

  if (!existingSub) {
    return
  }

  // Obtener plan Free
  const { data: freePlan } = await supabaseAdmin
    .from("plans")
    .select("id")
    .eq("tipo", "FREE")
    .single()

  // Downgrade a plan Free
  await supabaseAdmin
    .from("subscriptions")
    .update({
      plan_id: freePlan?.id,
      status: "ACTIVE",
      payment_provider: null,
      stripe_subscription_id: null,
      cancel_at_period_end: false,
      canceled_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscription.id)

  console.log(`Subscription ${subscription.id} deleted, downgraded to Free`)
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
  // Cast to any to handle Stripe type variations
  const inv = invoice as any
  const subscriptionId = inv.subscription as string
  if (!subscriptionId) return

  const { data: subscription } = await supabaseAdmin
    .from("subscriptions")
    .select("id, organization_id")
    .eq("stripe_subscription_id", subscriptionId)
    .single()

  if (!subscription) return

  // Registrar pago
  await supabaseAdmin.from("subscription_payments").insert({
    subscription_id: subscription.id,
    organization_id: subscription.organization_id,
    amount: (inv.amount_paid || 0) / 100, // Convertir de centavos
    currency: inv.currency?.toUpperCase() || "USD",
    payment_provider: "STRIPE",
    provider_payment_id: inv.payment_intent as string,
    provider_invoice_id: invoice.id,
    status: "SUCCEEDED",
    invoice_url: inv.hosted_invoice_url || null,
    receipt_url: inv.invoice_pdf || null,
    paid_at: inv.status_transitions?.paid_at
      ? new Date(inv.status_transitions.paid_at * 1000).toISOString()
      : new Date().toISOString(),
  })

  console.log(`Payment recorded for subscription ${subscriptionId}`)
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  // Cast to any to handle Stripe type variations
  const inv = invoice as any
  const subscriptionId = inv.subscription as string
  if (!subscriptionId) return

  const { data: subscription } = await supabaseAdmin
    .from("subscriptions")
    .select("id, organization_id")
    .eq("stripe_subscription_id", subscriptionId)
    .single()

  if (!subscription) return

  // Actualizar estado de suscripción
  await supabaseAdmin
    .from("subscriptions")
    .update({ status: "PAST_DUE" })
    .eq("id", subscription.id)

  // Registrar pago fallido
  await supabaseAdmin.from("subscription_payments").insert({
    subscription_id: subscription.id,
    organization_id: subscription.organization_id,
    amount: (inv.amount_due || 0) / 100,
    currency: inv.currency?.toUpperCase() || "USD",
    payment_provider: "STRIPE",
    provider_payment_id: inv.payment_intent as string,
    provider_invoice_id: invoice.id,
    status: "FAILED",
  })

  console.log(`Payment failed for subscription ${subscriptionId}`)
}

function mapStripeStatus(
  stripeStatus: Stripe.Subscription.Status
): "ACTIVE" | "CANCELED" | "PAST_DUE" | "TRIALING" {
  switch (stripeStatus) {
    case "active":
      return "ACTIVE"
    case "past_due":
    case "unpaid":
      return "PAST_DUE"
    case "canceled":
    case "incomplete_expired":
      return "CANCELED"
    case "trialing":
      return "TRIALING"
    default:
      return "ACTIVE"
  }
}
