import {
  lemonSqueezySetup,
  createCheckout,
  cancelSubscription as lsCancelSubscription,
  getSubscription as lsGetSubscription,
} from "@lemonsqueezy/lemonsqueezy.js"

// Initialize LemonSqueezy with API key
function initLemonSqueezy() {
  const apiKey = process.env.LEMONSQUEEZY_API_KEY
  if (!apiKey) {
    throw new Error("LEMONSQUEEZY_API_KEY not configured")
  }
  lemonSqueezySetup({ apiKey })
}

// Precios del plan Premium en USD
export const LS_PRICES = {
  MONTHLY: 12, // $12 USD
  YEARLY: 115, // $115 USD (~20% off $144)
}

// Crear checkout session de LemonSqueezy
export async function createLemonSqueezyCheckout({
  organizationId,
  organizationName,
  email,
  billingPeriod,
  successUrl,
}: {
  organizationId: string
  organizationName: string
  email: string
  billingPeriod: "MONTHLY" | "YEARLY"
  successUrl: string
}) {
  initLemonSqueezy()

  const storeId = process.env.LEMONSQUEEZY_STORE_ID
  const variantId =
    billingPeriod === "YEARLY"
      ? process.env.LEMONSQUEEZY_VARIANT_YEARLY
      : process.env.LEMONSQUEEZY_VARIANT_MONTHLY

  if (!storeId || !variantId) {
    throw new Error("LemonSqueezy store/variant IDs not configured")
  }

  const { data, error } = await createCheckout(storeId, variantId, {
    checkoutData: {
      email,
      custom: {
        organization_id: organizationId,
        organization_name: organizationName,
        billing_period: billingPeriod,
      },
    },
    productOptions: {
      redirectUrl: successUrl,
    },
  })

  if (error) {
    throw new Error(`LemonSqueezy checkout error: ${error.message}`)
  }

  return data
}

// Cancelar suscripción
export async function cancelLemonSqueezySubscription(subscriptionId: string) {
  initLemonSqueezy()
  const { data, error } = await lsCancelSubscription(subscriptionId)

  if (error) {
    throw new Error(`LemonSqueezy cancel error: ${error.message}`)
  }

  return data
}

// Obtener suscripción
export async function getLemonSqueezySubscription(subscriptionId: string) {
  initLemonSqueezy()
  const { data, error } = await lsGetSubscription(subscriptionId)

  if (error) {
    throw new Error(`LemonSqueezy get subscription error: ${error.message}`)
  }

  return data
}

// Verificar firma del webhook
export function verifyLemonSqueezyWebhook(
  payload: string,
  signature: string
): boolean {
  const crypto = require("crypto")
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET

  if (!secret) {
    console.warn("No LEMONSQUEEZY_WEBHOOK_SECRET configured")
    return process.env.NODE_ENV !== "production"
  }

  const hmac = crypto.createHmac("sha256", secret).update(payload).digest("hex")
  return hmac === signature
}
