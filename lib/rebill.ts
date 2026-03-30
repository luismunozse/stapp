import { getPremiumPrices } from "@/lib/pricing"

const REBILL_API_URL = "https://api.rebill.com/v3"

function getApiKey(): string {
  const key = process.env.REBILL_API_KEY
  if (!key) {
    throw new Error("REBILL_API_KEY not configured")
  }
  return key
}

async function rebillFetch(path: string, options: RequestInit = {}) {
  const response = await fetch(`${REBILL_API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": getApiKey(),
      ...options.headers,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Rebill API error (${response.status}): ${errorText}`)
  }

  return response.json()
}

async function getRebillPrices() {
  const prices = await getPremiumPrices()
  return {
    MONTHLY: { amount: prices.usd.monthly, currency: "USD" },
    YEARLY: { amount: prices.usd.yearly, currency: "USD" },
  }
}

// Crear checkout de suscripción via Payment Link
export async function createRebillCheckout({
  organizationId,
  organizationName,
  email,
  billingPeriod,
  successUrl,
  failureUrl,
}: {
  organizationId: string
  organizationName: string
  email: string
  billingPeriod: "MONTHLY" | "YEARLY"
  successUrl: string
  failureUrl: string
}) {
  const prices = await getRebillPrices()
  const price = billingPeriod === "YEARLY" ? prices.YEARLY : prices.MONTHLY

  const frequency =
    billingPeriod === "YEARLY"
      ? { period: "year", count: 1 }
      : { period: "month", count: 1 }

  const title =
    billingPeriod === "YEARLY"
      ? "Plan Premium Anual - STApp"
      : "Plan Premium Mensual - STApp"

  // Crear payment link con suscripción instantánea
  const paymentLink = await rebillFetch("/payment-links", {
    method: "POST",
    body: JSON.stringify({
      title: [{ text: title, language: "es" }],
      description: [
        {
          text: `Suscripción ${billingPeriod === "YEARLY" ? "anual" : "mensual"} para ${organizationName}`,
          language: "es",
        },
      ],
      type: "instant",
      amount: price.amount,
      currency: price.currency,
      name: title,
      frequency,
      isSingleUse: true,
      redirectUrls: {
        approved: successUrl,
        rejected: failureUrl,
        pending: successUrl,
      },
      prefilledFields: {
        customer: {
          email,
        },
      },
      metadata: {
        organization_id: organizationId,
        organization_name: organizationName,
        billing_period: billingPeriod,
      },
    }),
  })

  return {
    url: paymentLink.url,
    id: paymentLink.id,
  }
}

// Cancelar suscripción en Rebill
export async function cancelRebillSubscription(subscriptionId: string) {
  return await rebillFetch(`/subscriptions/${subscriptionId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "cancelled" }),
  })
}

// Obtener suscripción de Rebill
export async function getRebillSubscription(subscriptionId: string) {
  return await rebillFetch(`/subscriptions/${subscriptionId}`)
}
