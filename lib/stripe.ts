import Stripe from "stripe"

// Lazy initialization to avoid errors during build
let _stripe: Stripe | null = null

function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY not configured")
    }
    _stripe = new Stripe(key, {
      apiVersion: "2025-12-15.clover",
      typescript: true,
    })
  }
  return _stripe
}

// Export for backward compatibility
export const stripe = {
  get checkout() {
    return getStripe().checkout
  },
  get billingPortal() {
    return getStripe().billingPortal
  },
  get subscriptions() {
    return getStripe().subscriptions
  },
  get customers() {
    return getStripe().customers
  },
  get webhooks() {
    return getStripe().webhooks
  },
}

// Crear sesión de checkout para suscripción
export async function createCheckoutSession({
  organizationId,
  organizationName,
  email,
  priceId,
  successUrl,
  cancelUrl,
}: {
  organizationId: string
  organizationName: string
  email: string
  priceId: string
  successUrl: string
  cancelUrl: string
}): Promise<Stripe.Checkout.Session> {
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    customer_email: email,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    metadata: {
      organization_id: organizationId,
      organization_name: organizationName,
    },
    subscription_data: {
      metadata: {
        organization_id: organizationId,
      },
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
  })

  return session
}

// Crear portal de facturación para cliente existente
export async function createBillingPortalSession({
  customerId,
  returnUrl,
}: {
  customerId: string
  returnUrl: string
}): Promise<Stripe.BillingPortal.Session> {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  })

  return session
}

// Cancelar suscripción
export async function cancelSubscription(
  subscriptionId: string,
  cancelAtPeriodEnd: boolean = true
): Promise<Stripe.Subscription> {
  if (cancelAtPeriodEnd) {
    // Cancelar al final del período actual
    return await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    })
  } else {
    // Cancelar inmediatamente
    return await stripe.subscriptions.cancel(subscriptionId)
  }
}

// Reactivar suscripción cancelada
export async function reactivateSubscription(
  subscriptionId: string
): Promise<Stripe.Subscription> {
  return await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
  })
}

// Obtener suscripción
export async function getSubscription(
  subscriptionId: string
): Promise<Stripe.Subscription | null> {
  try {
    return await stripe.subscriptions.retrieve(subscriptionId)
  } catch {
    return null
  }
}

// Obtener cliente por email o crear uno nuevo
export async function getOrCreateCustomer(
  email: string,
  metadata?: Record<string, string>
): Promise<Stripe.Customer> {
  const existingCustomers = await stripe.customers.list({
    email,
    limit: 1,
  })

  if (existingCustomers.data.length > 0) {
    return existingCustomers.data[0]
  }

  return await stripe.customers.create({
    email,
    metadata,
  })
}

// Verificar firma del webhook
export function constructWebhookEvent(
  payload: string | Buffer,
  signature: string
): Stripe.Event {
  return stripe.webhooks.constructEvent(
    payload,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!
  )
}

// Precios del plan Premium
export const STRIPE_PRICES = {
  MONTHLY: process.env.STRIPE_PRICE_MONTHLY || "",
  YEARLY: process.env.STRIPE_PRICE_YEARLY || "",
}
