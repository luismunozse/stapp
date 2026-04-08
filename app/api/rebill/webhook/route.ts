import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqual } from "crypto"
import { supabaseAdmin } from "@/lib/supabase"
import { beginWebhookEvent, finishWebhookEvent } from "@/lib/webhook-log"

/**
 * Verificación de autenticidad del webhook de Rebill.
 *
 * Rebill todavía no expone firmas HMAC en sus webhooks (verificado al
 * momento de escribir esto). Mientras tanto, exigimos un shared secret
 * tipo "bearer token" que se configura como `REBILL_WEBHOOK_TOKEN` y se
 * setea en el panel de Rebill como header `Authorization` o
 * `X-Webhook-Token`. Esto previene que cualquier tercero pueda llamar
 * a `/api/rebill/webhook` y disparar lógica de pagos.
 *
 * Comportamiento:
 *  - Producción + sin token configurado → rechazo (fail-closed)
 *  - Dev + sin token → bypass con warning para poder testear local
 *  - Token configurado → comparación constant-time contra header
 */
type RebillAuthResult =
  | { valid: true; reason: string; bypassedNoSecret?: boolean }
  | { valid: false; reason: string }

function verifyRebillAuth(request: NextRequest): RebillAuthResult {
  const expected = process.env.REBILL_WEBHOOK_TOKEN

  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[rebill-webhook] CRITICAL: REBILL_WEBHOOK_TOKEN no configurado en producción - rechazando webhook"
      )
      return { valid: false, reason: "missing_secret_in_production" }
    }
    console.warn(
      "[rebill-webhook] REBILL_WEBHOOK_TOKEN no configurado - aceptando sin verificar (solo dev)"
    )
    return { valid: true, reason: "no_secret_configured", bypassedNoSecret: true }
  }

  // Aceptamos el token en `Authorization: Bearer <token>` o en
  // `X-Webhook-Token`. Algunos paneles de Rebill solo permiten setear
  // headers custom, otros solo `Authorization`.
  const authHeader = request.headers.get("authorization") || ""
  const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : ""
  const customToken = request.headers.get("x-webhook-token")?.trim() || ""
  const provided = bearerToken || customToken

  if (!provided) return { valid: false, reason: "missing_auth_header" }

  // Comparación constant-time para evitar timing attacks.
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return { valid: false, reason: "token_mismatch" }
  if (!timingSafeEqual(a, b)) return { valid: false, reason: "token_mismatch" }

  return { valid: true, reason: "ok" }
}

export async function POST(request: NextRequest) {
  let body: any = null
  try {
    body = await request.json()
  } catch {
    const log = await beginWebhookEvent({
      provider: "REBILL",
      payload: null,
      headers: {
        "content-type": request.headers.get("content-type"),
        "user-agent": request.headers.get("user-agent"),
      },
    })
    await finishWebhookEvent(log, {
      status: "ERROR",
      httpStatus: 400,
      errorMessage: "invalid_json_body",
    })
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { event, data } = body || {}

  // Verificar autenticidad ANTES de procesar nada.
  const auth = verifyRebillAuth(request)

  const log = await beginWebhookEvent({
    provider: "REBILL",
    eventType: event ?? null,
    providerEventId: data?.id != null ? String(data.id) : null,
    payload: body,
    headers: {
      "content-type": request.headers.get("content-type"),
      "user-agent": request.headers.get("user-agent"),
      "x-rebill-signature": request.headers.get("x-rebill-signature"),
    },
    signatureValid: auth.valid,
  })

  if (!auth.valid) {
    console.error(`[rebill-webhook] Auth inválida (${auth.reason})`)
    await finishWebhookEvent(log, {
      status: "INVALID_SIGNATURE",
      httpStatus: 401,
      errorMessage: `auth_${auth.reason}`,
    })
    return NextResponse.json(
      { error: "Unauthorized", reason: auth.reason },
      { status: 401 }
    )
  }

  try {
    let result: { organizationId?: string | null; reason?: string; processed: boolean } = {
      processed: false,
      reason: "unhandled_event",
    }

    switch (event) {
      case "payment.created":
      case "payment.updated":
        result = await handlePaymentEvent(data)
        break

      case "subscription.created":
      case "subscription.updated":
        result = await handleSubscriptionEvent(data)
        break

      default:
        console.log(`[rebill-webhook] Unhandled event: ${event}`)
        result = { processed: false, reason: `unhandled_event_${event}` }
    }

    await finishWebhookEvent(log, {
      status: result.processed ? "PROCESSED" : "SKIPPED",
      httpStatus: 200,
      organizationId: result.organizationId ?? null,
      errorMessage: result.reason ?? null,
    })

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error("[rebill-webhook] Error procesando webhook:", error)
    await finishWebhookEvent(log, {
      status: "ERROR",
      httpStatus: 500,
      error,
    })
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    )
  }
}

type RebillHandlerResult = {
  processed: boolean
  organizationId?: string | null
  reason?: string
}

async function handlePaymentEvent(data: any): Promise<RebillHandlerResult> {
  const payment = data
  const metadata = payment.metadata || {}
  const organizationId = metadata.organization_id

  if (!organizationId) {
    console.error("[rebill-webhook] No organization_id in payment metadata")
    return { processed: false, reason: "missing_organization_id" }
  }

  // Validar que la organización exista
  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("id, activo")
    .eq("id", organizationId)
    .single()

  if (!org || org.activo === false) {
    console.error(`[rebill-webhook] Organization ${organizationId} not found or inactive`)
    return { processed: false, reason: "org_not_found_or_inactive", organizationId }
  }

  // Solo procesar pagos aprobados
  if (payment.status !== "approved") {
    console.log(`[rebill-webhook] Payment ${payment.id} status: ${payment.status}`)

    // Si el pago falló, actualizar suscripción a PAST_DUE
    if (payment.status === "rejected" || payment.status === "failed") {
      await supabaseAdmin
        .from("subscriptions")
        .update({ status: "PAST_DUE" })
        .eq("organization_id", organizationId)
      return {
        processed: true,
        organizationId,
        reason: `payment_${payment.status}_marked_past_due`,
      }
    }
    return {
      processed: false,
      organizationId,
      reason: `payment_status_${payment.status}`,
    }
  }

  // Obtener plan Premium
  const { data: premiumPlan } = await supabaseAdmin
    .from("plans")
    .select("id")
    .eq("tipo", "PREMIUM")
    .single()

  if (!premiumPlan) {
    console.error("[rebill-webhook] Premium plan not found")
    return { processed: false, reason: "premium_plan_not_found", organizationId }
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

  console.log(`[rebill-webhook] Payment ${payment.id} processed for org ${organizationId}`)
  return { processed: true, organizationId }
}

async function handleSubscriptionEvent(data: any): Promise<RebillHandlerResult> {
  const subscription = data
  const metadata = subscription.metadata || {}
  const organizationId = metadata.organization_id

  if (!organizationId) {
    console.error("[rebill-webhook] No organization_id in subscription metadata")
    return { processed: false, reason: "missing_organization_id" }
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

  console.log(`[rebill-webhook] Subscription ${subscription.id} updated to ${status}`)
  return { processed: true, organizationId }
}

// GET para verificación de webhook
export async function GET() {
  return NextResponse.json({ status: "ok" })
}
