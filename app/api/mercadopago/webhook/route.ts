import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { verifyWebhookSignature } from "@/lib/mercadopago"
import { beginWebhookEvent, finishWebhookEvent } from "@/lib/webhook-log"

export async function POST(request: NextRequest) {
  // Capturamos el body como texto primero para poder parsearlo y loguearlo
  // aunque venga roto. Si MP nos manda algo no-JSON queremos saberlo.
  let bodyText = ""
  let body: any = null
  try {
    bodyText = await request.text()
    body = bodyText ? JSON.parse(bodyText) : {}
  } catch (parseErr) {
    console.error("[mp-webhook] body no es JSON válido:", bodyText.slice(0, 200))
    // Logueamos igual el intento
    const log = await beginWebhookEvent({
      provider: "MERCADOPAGO",
      payload: { raw: bodyText.slice(0, 1000) },
      headers: collectHeaders(request),
    })
    await finishWebhookEvent(log, {
      status: "ERROR",
      httpStatus: 400,
      errorMessage: "invalid_json_body",
    })
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const xSignature = request.headers.get("x-signature")
  const xRequestId = request.headers.get("x-request-id")

  // MP firma usando data.id del query string. Body como fallback.
  const url = new URL(request.url)
  const dataIdFromQuery =
    url.searchParams.get("data.id") ||
    url.searchParams.get("id") ||
    null
  const dataIdFromBody =
    body?.data?.id != null ? String(body.data.id) : null
  const dataIdForSig = dataIdFromQuery || dataIdFromBody

  // Verificación de firma. En desarrollo (sin secret) se acepta con
  // bypassedNoSecret=true. Antes esto se silenciaba con `return true`,
  // ahora dejamos rastro en webhook_events para diagnosticar después.
  const sigCheck = verifyWebhookSignature(xSignature, xRequestId, dataIdForSig)

  // Iniciar registro del evento ANTES de cualquier procesamiento o rechazo,
  // para que cualquier intento (incluso uno con firma inválida) quede auditado.
  const log = await beginWebhookEvent({
    provider: "MERCADOPAGO",
    eventType: body?.type ?? null,
    providerEventId: dataIdForSig,
    providerRequestId: xRequestId,
    payload: body,
    headers: collectHeaders(request),
    signatureValid: sigCheck.valid,
  })

  // En producción exigimos firma válida. En dev (sin secret) se acepta.
  if (!sigCheck.valid) {
    console.error(
      `[mp-webhook] Firma inválida (${sigCheck.reason}) para data.id=${dataIdForSig}`
    )
    await finishWebhookEvent(log, {
      status: "INVALID_SIGNATURE",
      httpStatus: 401,
      errorMessage: `signature_${sigCheck.reason}`,
    })
    return NextResponse.json(
      { error: "Invalid signature", reason: sigCheck.reason },
      { status: 401 }
    )
  }

  try {
    const { type, data } = body

    let result: HandleResult = { status: "SKIPPED", reason: "unknown_event_type" }

    switch (type) {
      case "payment":
        result = await handlePaymentNotification(String(data?.id || ""))
        break

      case "subscription_preapproval":
        result = await handlePreApprovalNotification(String(data?.id || ""))
        break

      case "subscription_authorized_payment":
        result = await handlePaymentNotification(String(data?.id || ""))
        break

      default:
        console.log(`[mp-webhook] Unhandled event type: ${type}`)
        result = { status: "SKIPPED", reason: `unhandled_event_${type}` }
    }

    await finishWebhookEvent(log, {
      status: result.status === "PROCESSED" ? "PROCESSED" : "SKIPPED",
      httpStatus: 200,
      organizationId: result.organizationId ?? null,
      subscriptionPaymentId: result.subscriptionPaymentId ?? null,
      errorMessage: result.reason ?? null,
    })

    return NextResponse.json({ received: true, result })
  } catch (error) {
    console.error("[mp-webhook] Error procesando webhook:", error)
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

function collectHeaders(req: NextRequest): Record<string, string> {
  return {
    "x-signature": req.headers.get("x-signature") || "",
    "x-request-id": req.headers.get("x-request-id") || "",
    "content-type": req.headers.get("content-type") || "",
    "user-agent": req.headers.get("user-agent") || "",
  }
}

// ============================================================
// Handlers de eventos
// ============================================================

export interface HandleResult {
  status: "PROCESSED" | "SKIPPED"
  reason?: string
  organizationId?: string | null
  subscriptionPaymentId?: string | null
}

/**
 * Procesa una notificación de pago de MercadoPago.
 *
 * Esta función está EXPORTADA porque también la usa el endpoint de
 * reconciliación manual /api/superadmin/payments/reconcile-mp:
 * cuando un pago real no impactó por la razón que sea, el superadmin
 * pega el Payment ID y se vuelve a correr esta lógica con idempotencia.
 *
 * Idempotencia: si el (provider_payment_id, payment_provider) ya existe
 * en subscription_payments, retornamos sin tocar la suscripción.
 */
export async function handlePaymentNotification(
  paymentId: string
): Promise<HandleResult> {
  if (!paymentId) {
    return { status: "SKIPPED", reason: "missing_payment_id" }
  }

  // Obtener detalles del pago desde MercadoPago
  const response = await fetch(
    `https://api.mercadopago.com/v1/payments/${paymentId}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
      },
    }
  )

  if (!response.ok) {
    const errText = await response.text()
    console.error(`[MP webhook] Error fetching payment ${paymentId}:`, errText)
    throw new Error(`MP API error fetching payment ${paymentId}: ${errText}`)
  }

  const payment = await response.json()

  // Extraer external_reference
  let externalRef: {
    organization_id?: string
    billing_period?: string
    plan_id?: string
    plan_slug?: string
  }
  try {
    externalRef = JSON.parse(payment.external_reference || "{}")
  } catch {
    console.error(`[MP webhook] Invalid external_reference for payment ${paymentId}:`, payment.external_reference)
    return { status: "SKIPPED", reason: "invalid_external_reference" }
  }

  const organizationId = externalRef.organization_id
  if (!organizationId) {
    console.error(`[MP webhook] No organization_id in external_reference for payment ${paymentId}`)
    return { status: "SKIPPED", reason: "missing_organization_id" }
  }

  // Validar que la organización exista y esté activa
  const { data: org, error: orgError } = await supabaseAdmin
    .from("organizations")
    .select("id, activo")
    .eq("id", organizationId)
    .single()

  if (orgError || !org || org.activo === false) {
    console.error(`[MP webhook] Organization ${organizationId} not found or inactive (payment ${paymentId})`, orgError)
    return {
      status: "SKIPPED",
      reason: "org_not_found_or_inactive",
      organizationId,
    }
  }

  // Solo procesar pagos aprobados
  if (payment.status !== "approved") {
    console.log(`[MP webhook] Payment ${paymentId} status: ${payment.status} - ignorando`)
    return {
      status: "SKIPPED",
      reason: `payment_status_${payment.status}`,
      organizationId,
    }
  }

  // Idempotencia: si ya registramos este pago, salir temprano (MP reintenta múltiples veces)
  const { data: existingPayment } = await supabaseAdmin
    .from("subscription_payments")
    .select("id")
    .eq("provider_payment_id", String(paymentId))
    .eq("payment_provider", "MERCADOPAGO")
    .maybeSingle()

  if (existingPayment) {
    console.log(`[MP webhook] Payment ${paymentId} ya registrado (id=${existingPayment.id}) - skip`)
    return {
      status: "SKIPPED",
      reason: "already_processed",
      organizationId,
      subscriptionPaymentId: existingPayment.id,
    }
  }

  // Resolver el plan del pago.
  // Prioridad: plan_id del external_reference > plan_slug > fallback a 'profesional'.
  // El fallback existe para pagos viejos (antes de la migración 107) que no
  // tenían plan_id en external_reference.
  let targetPlan: { id: string; slug: string | null } | null = null

  if (externalRef.plan_id) {
    const { data } = await supabaseAdmin
      .from("plans")
      .select("id, slug")
      .eq("id", externalRef.plan_id)
      .maybeSingle()
    if (data) targetPlan = data
  }

  if (!targetPlan && externalRef.plan_slug) {
    const { data } = await supabaseAdmin
      .from("plans")
      .select("id, slug")
      .eq("slug", externalRef.plan_slug)
      .maybeSingle()
    if (data) targetPlan = data
  }

  // Fallback: plan Profesional (antes era el único PREMIUM)
  if (!targetPlan) {
    const { data } = await supabaseAdmin
      .from("plans")
      .select("id, slug")
      .eq("slug", "profesional")
      .maybeSingle()
    if (data) targetPlan = data
  }

  // Ultimo fallback: cualquier PREMIUM activo con mayor tier_order
  if (!targetPlan) {
    const { data } = await supabaseAdmin
      .from("plans")
      .select("id, slug")
      .eq("tipo", "PREMIUM")
      .eq("activo", true)
      .order("tier_order", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
    if (data) targetPlan = data
  }

  if (!targetPlan) {
    console.error(`[MP webhook] No target plan found (payment ${paymentId})`)
    throw new Error("Target plan not found")
  }

  const premiumPlan = targetPlan

  // Calcular período: si la suscripción está activa y vigente, EXTENDER desde el final actual
  const billingPeriod = externalRef.billing_period || "MONTHLY"
  const periodMonths = billingPeriod === "YEARLY" ? 12 : 1
  const now = new Date()

  const { data: existingSub } = await supabaseAdmin
    .from("subscriptions")
    .select("id, status, current_period_end, payment_provider")
    .eq("organization_id", organizationId)
    .maybeSingle()

  let periodStart = now
  if (
    existingSub?.status === "ACTIVE" &&
    existingSub.current_period_end &&
    new Date(existingSub.current_period_end) > now
  ) {
    periodStart = new Date(existingSub.current_period_end)
  }
  const periodEnd = new Date(periodStart)
  periodEnd.setMonth(periodEnd.getMonth() + periodMonths)

  // Actualizar o crear suscripción
  const { error: subError } = await supabaseAdmin
    .from("subscriptions")
    .upsert(
      {
        organization_id: organizationId,
        plan_id: premiumPlan.id,
        status: "ACTIVE",
        billing_period: billingPeriod,
        payment_provider: "MERCADOPAGO",
        mercadopago_payer_id: payment.payer?.id?.toString() || null,
        current_period_start: periodStart.toISOString(),
        current_period_end: periodEnd.toISOString(),
        cancel_at_period_end: false,
        canceled_at: null,
      },
      {
        onConflict: "organization_id",
      }
    )

  if (subError) {
    console.error(`[MP webhook] Error upserting subscription for org ${organizationId} (payment ${paymentId}):`, subError)
    throw subError
  }

  // Obtener suscripción para guardar pago
  const { data: subscription, error: fetchSubError } = await supabaseAdmin
    .from("subscriptions")
    .select("id")
    .eq("organization_id", organizationId)
    .single()

  if (fetchSubError || !subscription) {
    console.error(`[MP webhook] Could not fetch subscription after upsert for org ${organizationId} (payment ${paymentId}):`, fetchSubError)
    throw fetchSubError || new Error("Subscription not found after upsert")
  }

  // paid_at: usar date_approved si está, si no caer a now
  const paidAtRaw = payment.date_approved || payment.date_created
  const paidAt = paidAtRaw ? new Date(paidAtRaw) : new Date()
  const paidAtIso = isNaN(paidAt.getTime()) ? new Date().toISOString() : paidAt.toISOString()

  // Registrar pago - chequeando errores
  const { data: insertedPayment, error: payInsertError } = await supabaseAdmin
    .from("subscription_payments")
    .insert({
      subscription_id: subscription.id,
      organization_id: organizationId,
      amount: payment.transaction_amount ?? 0,
      currency: payment.currency_id || "ARS",
      payment_provider: "MERCADOPAGO",
      provider_payment_id: String(paymentId),
      status: "SUCCEEDED",
      paid_at: paidAtIso,
    })
    .select("id")
    .single()

  if (payInsertError) {
    console.error(`[MP webhook] Error inserting subscription_payment for org ${organizationId} (payment ${paymentId}):`, payInsertError)
    throw payInsertError
  }

  console.log(`[MP webhook] MercadoPago payment ${paymentId} processed for org ${organizationId}`)

  return {
    status: "PROCESSED",
    organizationId,
    subscriptionPaymentId: insertedPayment?.id ?? null,
  }
}

async function handlePreApprovalNotification(
  preApprovalId: string
): Promise<HandleResult> {
  if (!preApprovalId) {
    return { status: "SKIPPED", reason: "missing_preapproval_id" }
  }

  const response = await fetch(
    `https://api.mercadopago.com/preapproval/${preApprovalId}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
      },
    }
  )

  if (!response.ok) {
    console.error("[MP webhook] Error fetching preapproval:", await response.text())
    return { status: "SKIPPED", reason: "preapproval_fetch_error" }
  }

  const preApproval = await response.json()

  let externalRef: { organization_id?: string }
  try {
    externalRef = JSON.parse(preApproval.external_reference || "{}")
  } catch {
    return { status: "SKIPPED", reason: "invalid_external_reference" }
  }

  const organizationId = externalRef.organization_id
  if (!organizationId) return { status: "SKIPPED", reason: "missing_organization_id" }

  const statusMap: Record<string, "ACTIVE" | "CANCELED" | "PAST_DUE"> = {
    authorized: "ACTIVE",
    paused: "PAST_DUE",
    cancelled: "CANCELED",
  }

  const status = statusMap[preApproval.status] || "ACTIVE"

  await supabaseAdmin
    .from("subscriptions")
    .update({
      status,
      mercadopago_preapproval_id: preApprovalId,
    })
    .eq("organization_id", organizationId)

  console.log(`[MP webhook] PreApproval ${preApprovalId} updated to ${status}`)
  return { status: "PROCESSED", organizationId }
}

// GET para verificación de webhook (algunos proveedores lo requieren)
export async function GET() {
  return NextResponse.json({ status: "ok" })
}
