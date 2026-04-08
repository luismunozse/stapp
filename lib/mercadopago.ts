import { MercadoPagoConfig, Preference, PreApproval } from "mercadopago"
import { getPremiumPrices } from "@/lib/pricing"

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

// Obtener precios dinámicos desde la base de datos
async function getMPPrices() {
  const prices = await getPremiumPrices()
  return {
    MONTHLY: {
      amount: Math.round(prices.ars.monthly * 100), // en centavos
      currency: "ARS",
    },
    YEARLY: {
      amount: Math.round(prices.ars.yearly * 100), // en centavos
      currency: "ARS",
    },
  }
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
  const mpPrices = await getMPPrices()
  const price = billingPeriod === "YEARLY" ? mpPrices.YEARLY : mpPrices.MONTHLY
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
  const mpPrices = await getMPPrices()
  const price = billingPeriod === "YEARLY" ? mpPrices.YEARLY : mpPrices.MONTHLY
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

/**
 * Resultado detallado de la verificación de firma de webhook.
 *
 * El motivo de devolver detalle (en vez de un boolean) es que en producción
 * tuvimos un caso donde un pago real no se registró y no había forma de
 * saber si fue por firma inválida, secret faltante o porque MP nunca
 * disparó la notificación. Ahora cada intento queda persistido en
 * webhook_events junto con `signature_valid` y un mensaje legible.
 */
export interface WebhookSignatureResult {
  valid: boolean
  reason: string
  /** True si no había secret configurado y se aceptó el webhook por defecto */
  bypassedNoSecret?: boolean
}

/**
 * Verificar firma del webhook IPN de MercadoPago.
 *
 * Doc oficial: https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks
 *
 * Importante:
 *  - MP firma `id:<dataId>;request-id:<requestId>;ts:<ts>;`
 *  - El `dataId` que MP usa para firmar viene en el QUERY STRING de la URL
 *    (`?data.id=...&type=payment`), NO necesariamente en el body.
 *    Antes leíamos `body.data?.id` y eso podía no coincidir, generando
 *    falsos negativos. Ahora aceptamos un `dataId` que el caller debe
 *    extraer del query primero, body como fallback.
 *  - MP recomienda lowercase del id antes de firmar cuando contiene letras.
 */
export function verifyWebhookSignature(
  xSignature: string | null,
  xRequestId: string | null,
  dataId: string | null
): WebhookSignatureResult {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET

  if (!secret) {
    // Fail-closed en producción: si por error de deploy falta el secret,
    // NO aceptar webhooks sin verificar (un atacante podría inyectar
    // notificaciones falsas y disparar lógica de pagos).
    // En dev/test sí permitimos el bypass para poder testear local.
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[mp-webhook] CRITICAL: MERCADOPAGO_WEBHOOK_SECRET no configurado en producción - rechazando webhook"
      )
      return {
        valid: false,
        reason: "missing_secret_in_production",
      }
    }

    console.warn(
      "[mp-webhook] MERCADOPAGO_WEBHOOK_SECRET no configurado - aceptando sin verificar (solo dev)"
    )
    return {
      valid: true,
      reason: "no_secret_configured",
      bypassedNoSecret: true,
    }
  }

  if (!xSignature) return { valid: false, reason: "missing_x_signature" }
  if (!xRequestId) return { valid: false, reason: "missing_x_request_id" }
  if (!dataId) return { valid: false, reason: "missing_data_id" }

  const parts = xSignature.split(",")
  const ts = parts.find((p) => p.trim().startsWith("ts="))?.split("=")[1]?.trim()
  const v1 = parts.find((p) => p.trim().startsWith("v1="))?.split("=")[1]?.trim()

  if (!ts) return { valid: false, reason: "x_signature_missing_ts" }
  if (!v1) return { valid: false, reason: "x_signature_missing_v1" }

  const crypto = require("crypto")
  // MP indica lowercase para ids alfanuméricos
  const normalizedId = String(dataId).toLowerCase()
  const manifest = `id:${normalizedId};request-id:${xRequestId};ts:${ts};`
  const hmac = crypto.createHmac("sha256", secret).update(manifest).digest("hex")

  if (hmac === v1) return { valid: true, reason: "ok" }

  return { valid: false, reason: "hmac_mismatch" }
}
