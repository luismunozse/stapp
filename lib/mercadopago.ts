import { MercadoPagoConfig, Preference, PreApproval } from "mercadopago"

// Lazy initialization to avoid errors during build
let _client: MercadoPagoConfig | null = null
let _preferenceApi: Preference | null = null
let _preApprovalApi: PreApproval | null = null

function getClient(): MercadoPagoConfig {
  if (!_client) {
    const token = process.env.MERCADOPAGO_ACCESS_TOKEN
    if (!token) {
      throw new Error("MERCADOPAGO_ACCESS_TOKEN not configured")
    }
    _client = new MercadoPagoConfig({ accessToken: token })
  }
  return _client
}

function getPreferenceApi(): Preference {
  if (!_preferenceApi) {
    _preferenceApi = new Preference(getClient())
  }
  return _preferenceApi
}

function getPreApprovalApi(): PreApproval {
  if (!_preApprovalApi) {
    _preApprovalApi = new PreApproval(getClient())
  }
  return _preApprovalApi
}

// Precios del plan Premium en pesos argentinos
export const MP_PRICES = {
  MONTHLY: {
    amount: 1499900, // $14.999 ARS (en centavos)
    currency: "ARS",
  },
  YEARLY: {
    amount: 14399000, // $143.990 ARS (en centavos)
    currency: "ARS",
  },
}

// Crear preferencia de pago único (para suscripción manual)
export async function createPaymentPreference({
  organizationId,
  organizationName,
  email,
  billingPeriod,
  successUrl,
  failureUrl,
  pendingUrl,
}: {
  organizationId: string
  organizationName: string
  email: string
  billingPeriod: "MONTHLY" | "YEARLY"
  successUrl: string
  failureUrl: string
  pendingUrl: string
}) {
  const price = billingPeriod === "YEARLY" ? MP_PRICES.YEARLY : MP_PRICES.MONTHLY
  const title =
    billingPeriod === "YEARLY"
      ? "Plan Premium Anual - Servicio Técnico"
      : "Plan Premium Mensual - Servicio Técnico"

  const preference = await getPreferenceApi().create({
    body: {
      items: [
        {
          id: `premium-${billingPeriod.toLowerCase()}`,
          title,
          quantity: 1,
          unit_price: price.amount / 100, // MP espera precio sin centavos
          currency_id: price.currency,
        },
      ],
      payer: {
        email,
      },
      back_urls: {
        success: successUrl,
        failure: failureUrl,
        pending: pendingUrl,
      },
      auto_return: "approved",
      external_reference: JSON.stringify({
        organization_id: organizationId,
        organization_name: organizationName,
        billing_period: billingPeriod,
      }),
      notification_url: `${process.env.NEXTAUTH_URL}/api/mercadopago/webhook`,
      statement_descriptor: "SERVICIO TECNICO",
    },
  })

  return preference
}

// Crear suscripción recurrente (PreApproval)
export async function createSubscription({
  organizationId,
  organizationName,
  email,
  billingPeriod,
  backUrl,
}: {
  organizationId: string
  organizationName: string
  email: string
  billingPeriod: "MONTHLY" | "YEARLY"
  backUrl: string
}) {
  const price = billingPeriod === "YEARLY" ? MP_PRICES.YEARLY : MP_PRICES.MONTHLY
  const frequency = billingPeriod === "YEARLY" ? 12 : 1

  const preApproval = await getPreApprovalApi().create({
    body: {
      reason: `Plan Premium - ${organizationName}`,
      auto_recurring: {
        frequency,
        frequency_type: "months",
        transaction_amount: price.amount / 100,
        currency_id: price.currency,
      },
      back_url: backUrl,
      payer_email: email,
      external_reference: JSON.stringify({
        organization_id: organizationId,
        billing_period: billingPeriod,
      }),
    },
  })

  return preApproval
}

// Cancelar suscripción
export async function cancelPreApproval(preApprovalId: string) {
  return await getPreApprovalApi().update({
    id: preApprovalId,
    body: {
      status: "cancelled",
    },
  })
}

// Obtener suscripción
export async function getPreApproval(preApprovalId: string) {
  return await getPreApprovalApi().get({ id: preApprovalId })
}

// Verificar firma del webhook (IPN)
export function verifyWebhookSignature(
  xSignature: string | null,
  xRequestId: string | null,
  dataId: string
): boolean {
  if (!xSignature || !xRequestId) return false

  const crypto = require("crypto")
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET

  if (!secret) {
    console.warn("No MERCADOPAGO_WEBHOOK_SECRET configured")
    return true // En desarrollo, permitir sin verificación
  }

  // Extraer ts y v1 de x-signature
  const parts = xSignature.split(",")
  const ts = parts.find((p) => p.startsWith("ts="))?.split("=")[1]
  const v1 = parts.find((p) => p.startsWith("v1="))?.split("=")[1]

  if (!ts || !v1) return false

  // Crear string para verificar
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`
  const hmac = crypto.createHmac("sha256", secret).update(manifest).digest("hex")

  return hmac === v1
}
