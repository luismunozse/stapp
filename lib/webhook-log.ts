/**
 * Helpers para registrar webhooks entrantes en la tabla webhook_events.
 *
 * El objetivo es nunca más quedarnos sin saber qué pasó con un pago:
 * cada notificación de MercadoPago / Rebill que entra al sistema queda
 * persistida con su payload, headers, status final y mensaje de error.
 *
 * Patrón de uso típico en una route de webhook:
 *
 *   const log = await beginWebhookEvent({
 *     provider: "MERCADOPAGO",
 *     eventType: body.type,
 *     providerEventId: body?.data?.id,
 *     providerRequestId: req.headers.get("x-request-id"),
 *     payload: body,
 *     headers: { "x-signature": req.headers.get("x-signature") },
 *     signatureValid,
 *   })
 *
 *   try {
 *     // ... procesar ...
 *     await finishWebhookEvent(log, { status: "PROCESSED", organizationId, httpStatus: 200 })
 *   } catch (e) {
 *     await finishWebhookEvent(log, { status: "ERROR", error: e, httpStatus: 500 })
 *     throw e
 *   }
 *
 * Si la BD está caída o la inserción falla, NUNCA tiramos la excepción
 * hacia arriba — lo último que queremos es que un fallo de logging haga
 * que MercadoPago marque el webhook como no entregado y lo reintente
 * indefinidamente.
 */

import { supabaseAdmin } from "@/lib/supabase"

export type WebhookProvider = "MERCADOPAGO" | "REBILL"

export type WebhookEventStatus =
  | "RECEIVED"
  | "PROCESSED"
  | "SKIPPED"
  | "INVALID_SIGNATURE"
  | "ERROR"

export interface BeginWebhookEventInput {
  provider: WebhookProvider
  eventType?: string | null
  providerEventId?: string | number | null
  providerRequestId?: string | null
  payload?: unknown
  rawPayload?: string | null
  headers?: Record<string, string | null | undefined>
  signatureValid?: boolean | null
}

export interface WebhookEventLog {
  id: string | null // null si no se pudo insertar (fallback en memoria)
  startedAt: number
  input: BeginWebhookEventInput
}

/**
 * Sanitiza headers — eliminamos cualquier clave que pueda contener secretos.
 */
function sanitizeHeaders(
  headers: Record<string, string | null | undefined> | undefined
): Record<string, string> | null {
  if (!headers) return null
  const out: Record<string, string> = {}
  const allowed = new Set([
    "x-signature",
    "x-request-id",
    "content-type",
    "user-agent",
    "x-rebill-signature",
  ])
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v !== "string") continue
    const key = k.toLowerCase()
    if (allowed.has(key)) {
      // Para x-signature solo guardamos los primeros 80 chars (suficiente para
      // saber que vino sin exponer todo el HMAC en claro).
      out[key] = key === "x-signature" ? v.slice(0, 80) : v
    }
  }
  return out
}

/**
 * Crea la fila inicial en webhook_events con status='RECEIVED'.
 * Devuelve un handle que se completa después con finishWebhookEvent.
 */
export async function beginWebhookEvent(
  input: BeginWebhookEventInput
): Promise<WebhookEventLog> {
  const startedAt = Date.now()

  try {
    const { data, error } = await supabaseAdmin
      .from("webhook_events")
      .insert({
        provider: input.provider,
        event_type: input.eventType ?? null,
        provider_event_id:
          input.providerEventId != null ? String(input.providerEventId) : null,
        provider_request_id: input.providerRequestId ?? null,
        payload: input.payload ?? null,
        raw_payload: input.rawPayload ?? null,
        headers: sanitizeHeaders(input.headers),
        signature_valid: input.signatureValid ?? null,
        status: "RECEIVED",
      })
      .select("id")
      .single()

    if (error || !data) {
      console.error("[webhook-log] beginWebhookEvent insert failed:", error)
      return { id: null, startedAt, input }
    }

    return { id: data.id as string, startedAt, input }
  } catch (e) {
    console.error("[webhook-log] beginWebhookEvent threw:", e)
    return { id: null, startedAt, input }
  }
}

export interface FinishWebhookEventInput {
  status: WebhookEventStatus
  httpStatus?: number
  organizationId?: string | null
  subscriptionPaymentId?: string | null
  error?: unknown
  errorMessage?: string | null
}

/**
 * Marca el webhook como finalizado y registra el resultado.
 * Idempotente y a prueba de fallos: si la fila inicial no existe
 * (porque la inserción inicial falló), no hace nada.
 */
export async function finishWebhookEvent(
  log: WebhookEventLog,
  result: FinishWebhookEventInput
): Promise<void> {
  if (!log.id) return

  const errorMessage =
    result.errorMessage ??
    (result.error instanceof Error
      ? result.error.message
      : result.error
        ? String(result.error)
        : null)

  try {
    await supabaseAdmin
      .from("webhook_events")
      .update({
        status: result.status,
        http_status: result.httpStatus ?? null,
        organization_id: result.organizationId ?? null,
        subscription_payment_id: result.subscriptionPaymentId ?? null,
        error_message: errorMessage,
        processed_at: new Date().toISOString(),
        duration_ms: Date.now() - log.startedAt,
      })
      .eq("id", log.id)
  } catch (e) {
    console.error("[webhook-log] finishWebhookEvent failed:", e)
  }
}
