/**
 * Integración con Creem (Merchant of Record) para cobro internacional en USD.
 *
 * MercadoPago cubre Argentina (ARS); Creem cubre el resto del mundo. Creem es
 * MoR: se encarga de impuestos/IVA globales, tarjetas internacionales y FX.
 *
 * Docs: https://docs.creem.io
 *  - Checkout: POST /v1/checkouts (header x-api-key) -> { checkout_url }
 *  - Webhooks: firma HMAC-SHA256 del raw body, hex, en header `creem-signature`.
 *  - Env: key `creem_test_*` = sandbox, `creem_*` = producción.
 */
import crypto from "crypto"

function getApiKey(): string {
  const key = process.env.CREEM_API_KEY
  if (!key) throw new Error("CREEM_API_KEY not configured")
  return key
}

/** La base URL se deduce del prefijo de la key (test vs prod), como recomienda Creem. */
function getBaseUrl(): string {
  const key = process.env.CREEM_API_KEY || ""
  return key.startsWith("creem_test_")
    ? "https://test-api.creem.io/v1"
    : "https://api.creem.io/v1"
}

export interface CreemCheckoutParams {
  productId: string
  /** Idempotencia + correlación con nuestro lado. */
  requestId?: string
  email?: string | null
  successUrl: string
  /** Lo recuperamos en el webhook: organization_id, plan_id, etc. */
  metadata?: Record<string, string>
}

export interface CreemCheckoutResult {
  checkoutId?: string
  checkoutUrl: string
}

export async function createCreemCheckout(
  params: CreemCheckoutParams
): Promise<CreemCheckoutResult> {
  const res = await fetch(`${getBaseUrl()}/checkouts`, {
    method: "POST",
    headers: {
      "x-api-key": getApiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      product_id: params.productId,
      request_id: params.requestId,
      success_url: params.successUrl,
      ...(params.email ? { customer: { email: params.email } } : {}),
      ...(params.metadata ? { metadata: params.metadata } : {}),
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Creem checkout error (${res.status}): ${errText.slice(0, 500)}`)
  }

  const data = await res.json()
  const checkoutUrl = data?.checkout_url
  if (!checkoutUrl) {
    throw new Error(`Creem checkout sin checkout_url: ${JSON.stringify(data).slice(0, 300)}`)
  }
  return { checkoutId: data?.id, checkoutUrl }
}

/**
 * Verifica la firma del webhook de Creem.
 *
 * HMAC-SHA256(rawBody, secret) en hex, comparado con el header `creem-signature`.
 * Usa comparación de tiempo constante para no filtrar info por timing.
 */
export function verifyCreemSignature(
  rawBody: string,
  signature: string | null
): boolean {
  const secret = process.env.CREEM_WEBHOOK_SECRET
  if (!secret) {
    // Fail-closed en producción (igual criterio que MP): sin secret no aceptamos.
    if (process.env.NODE_ENV === "production") {
      console.error("[creem-webhook] CRITICAL: CREEM_WEBHOOK_SECRET no configurado en producción")
      return false
    }
    console.warn("[creem-webhook] CREEM_WEBHOOK_SECRET no configurado - aceptando sin verificar (solo dev)")
    return true
  }
  if (!signature) return false

  const computed = crypto.createHmac("sha256", secret).update(rawBody).digest("hex")

  // timingSafeEqual exige buffers del mismo largo.
  const a = Buffer.from(computed, "utf8")
  const b = Buffer.from(signature, "utf8")
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
