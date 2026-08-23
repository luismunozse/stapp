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
    rawPayload: bodyText,
    headers: collectHeaders(request),
    signatureValid: sigCheck.valid,
  })

  // Estrategia de verificación según el formato de la notificación:
  //
  //  - Webhooks v2 (`{ type, data: { id } }`): traen x-signature HMAC que SÍ
  //    podemos reproducir con el manifest documentado. La exigimos: un v2 mal
  //    firmado es sospechoso y se rechaza.
  //
  //  - IPN legacy (`{ topic, resource }`, que MP manda al notification_url de la
  //    preferencia): su x-signature NO se reproduce con el manifest v2 (probado
  //    contra el v1 real con el mismo secret que valida los v2 — ninguna variante
  //    matchea). No se pueden HMAC-verificar. En vez de descartarlos —y perder los
  //    pagos por preferencia, que SOLO llegan por este canal— confiamos en el
  //    re-fetch autenticado a la API de MP dentro del handler: el recurso debe
  //    existir y estar approved bajo NUESTRO access token, y el organization_id
  //    sale del external_reference del propio MP. Una notificación falsa no puede
  //    inyectar un pago inexistente ni redirigir fondos.
  const isV2 = typeof body?.type === "string"
  const ipnTopic =
    typeof body?.topic === "string" ? (body.topic as string) : null

  if (isV2 && !sigCheck.valid) {
    console.error(
      `[mp-webhook] Firma v2 inválida (${sigCheck.reason}) para data.id=${dataIdForSig}`
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
    let result: HandleResult = { status: "SKIPPED", reason: "unknown_event_shape" }

    if (isV2) {
      const { type, data } = body
      switch (type) {
        case "payment":
          result = await handlePaymentNotification(String(data?.id || ""))
          break

        case "subscription_preapproval":
          result = await handlePreApprovalNotification(String(data?.id || ""))
          break

        case "subscription_authorized_payment":
          result = await handleAuthorizedPaymentNotification(String(data?.id || ""))
          break

        default:
          console.log(`[mp-webhook] Unhandled v2 event type: ${type}`)
          result = { status: "SKIPPED", reason: `unhandled_event_${type}` }
      }
    } else if (ipnTopic) {
      // En IPN el id del recurso viaja en el query (`?id=...&topic=...`),
      // capturado en dataIdForSig. El body.resource de merchant_order es una
      // URL completa, así que usamos dataIdForSig (id pelado) en ambos casos.
      const resourceId = dataIdForSig || ""
      switch (ipnTopic) {
        case "payment":
          result = await handlePaymentNotification(resourceId)
          break

        case "merchant_order":
          result = await handleMerchantOrderNotification(resourceId)
          break

        default:
          console.log(`[mp-webhook] Unhandled IPN topic: ${ipnTopic}`)
          result = { status: "SKIPPED", reason: `unhandled_ipn_topic_${ipnTopic}` }
      }
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

    // Contar reintentos previos de este mismo evento para detectar fallos recurrentes
    const eventId = dataIdForSig
    let retryCount = 0
    let requiresManualReview = false

    if (eventId) {
      const { count } = await supabaseAdmin
        .from("webhook_events")
        .select("id", { count: "exact", head: true })
        .eq("provider_event_id", String(eventId))
        .eq("status", "ERROR")

      retryCount = (count ?? 0) + 1 // +1 por el error actual

      // Si superó 3 reintentos, marcar como requiere intervención manual
      if (retryCount >= 3) {
        requiresManualReview = true
        console.error(
          `[mp-webhook] Payment ${eventId} falló ${retryCount} veces. ` +
          `Marcado como requiere intervención manual.`
        )
      }
    }

    await finishWebhookEvent(log, {
      status: "ERROR",
      httpStatus: 500,
      error,
    })

    // Actualizar retry_count y requires_manual_review en el evento
    if (log.id) {
      try {
        await supabaseAdmin
          .from("webhook_events")
          .update({
            retry_count: retryCount,
            requires_manual_review: requiresManualReview,
          })
          .eq("id", log.id)
      } catch {
        // ignorar errores de actualización de tracking
      }
    }

    // Notificar al superadmin si es un fallo recurrente (3+ reintentos)
    if (requiresManualReview) {
      try {
        const adminEmail = process.env.SUPERADMIN_EMAIL || "admin@stapp.com.ar"
        const apiKey = process.env.ENVIALOSIMPLE_API_KEY
        if (apiKey) {
          await fetch("https://backend.envialosimple.email/api/v1/mail/send", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: process.env.EMAIL_FROM || "noreply@stapp.com.ar",
              to: adminEmail,
              subject: `[ALERTA] Webhook MercadoPago falla ${retryCount}x — payment ${eventId}`,
              html: `<p>El webhook para payment_id <strong>${eventId}</strong> falló <strong>${retryCount}</strong> veces.</p>
                     <p><strong>Error:</strong> ${error instanceof Error ? error.message : String(error)}</p>
                     <p>Requiere intervención manual desde el panel de SuperAdmin → Pagos.</p>`,
            }),
          }).catch(() => {})
        }
      } catch (notifErr) {
        // No bloquear el webhook por un error de notificación
        console.error("[mp-webhook] Error enviando alerta:", notifErr)
      }
    }

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
 *
 * SEPARACIÓN DE PASOS:
 *   (a) Registrar el pago como recibido (SUCCEEDED) → siempre se guarda
 *   (b) Activar/renovar la suscripción → si falla, el pago queda
 *       registrado igual y la suscripción en PENDING_ACTIVATION
 */
export interface PaymentExternalRef {
  organization_id?: string
  billing_period?: string
  plan_id?: string
  plan_slug?: string
}

export async function handlePaymentNotification(
  paymentId: string,
  externalRefOverride?: PaymentExternalRef
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

  // Extraer external_reference. Los pagos generados por una suscripción
  // recurrente no cargan external_reference: lo lleva sólo el preapproval
  // padre. En ese caso el caller (handleAuthorizedPaymentNotification) lo
  // inyecta via override después de consultarlo del preapproval.
  let externalRef: PaymentExternalRef
  if (externalRefOverride) {
    externalRef = externalRefOverride
  } else {
    try {
      externalRef = JSON.parse(payment.external_reference || "{}")
    } catch {
      console.error(`[MP webhook] Invalid external_reference for payment ${paymentId}:`, payment.external_reference)
      return { status: "SKIPPED", reason: "invalid_external_reference" }
    }
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
  // Prioridad: plan_id > plan_slug > plan de la suscripción activa > 'profesional' > cualquier PREMIUM.
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

  // Fallback: plan asignado a la suscripción activa de la org
  if (!targetPlan) {
    const { data: activeSub } = await supabaseAdmin
      .from("subscriptions")
      .select("plan_id, plans(id, slug)")
      .eq("organization_id", organizationId)
      .maybeSingle()
    if (activeSub?.plans) {
      const p = activeSub.plans as unknown as { id: string; slug: string | null }
      targetPlan = { id: p.id, slug: p.slug }
    }
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

  // --- PASO (a): Registrar el pago SIEMPRE, incluso si no hay plan ---
  // paid_at: usar date_approved si está, si no caer a now
  const paidAtRaw = payment.date_approved || payment.date_created
  const paidAt = paidAtRaw ? new Date(paidAtRaw) : new Date()
  const paidAtIso = isNaN(paidAt.getTime()) ? new Date().toISOString() : paidAt.toISOString()

  // Necesitamos un subscription_id. Intentar obtener la existente o crearla.
  let subscriptionId: string | null = null
  const { data: existingSub } = await supabaseAdmin
    .from("subscriptions")
    .select("id, status, current_period_end, payment_provider")
    .eq("organization_id", organizationId)
    .maybeSingle()

  subscriptionId = existingSub?.id ?? null

  // Calcular período anticipadamente para guardarlo con el pago
  const billingPeriod = externalRef.billing_period || "MONTHLY"
  const periodMonths = billingPeriod === "YEARLY" ? 12 : 1
  const now = new Date()

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

  // Registrar el pago como SUCCEEDED independientemente de si podemos activar la suscripción
  const { data: insertedPayment, error: payInsertError } = await supabaseAdmin
    .from("subscription_payments")
    .insert({
      subscription_id: subscriptionId,
      organization_id: organizationId,
      amount: payment.transaction_amount ?? 0,
      currency: payment.currency_id || "ARS",
      payment_provider: "MERCADOPAGO",
      provider_payment_id: String(paymentId),
      status: "SUCCEEDED",
      paid_at: paidAtIso,
      plan_name: targetPlan ? (targetPlan.slug ?? "Premium") : null,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
    })
    .select("id")
    .single()

  if (payInsertError) {
    // 23505 = unique_violation contra subscription_payments_provider_payment_uniq
    // (migracion 305): otra notificacion concurrente del MISMO pago ya lo
    // registro. El SELECT de idempotencia de mas arriba no alcanza porque
    // MercadoPago manda varias notificaciones casi simultaneas y todas leen
    // antes de que alguna commitee.
    //
    // Se sale ACA, sin tocar la suscripcion. Es el punto exacto donde se
    // regalaba un mes: el calculo del periodo arranca desde current_period_end
    // cuando la suscripcion ya esta ACTIVE, asi que la notificacion duplicada
    // apilaba otro mes sobre un unico pago.
    if ((payInsertError as { code?: string }).code === "23505") {
      console.log(
        `[MP webhook] Payment ${paymentId} ya registrado por una notificacion concurrente - skip`
      )
      return {
        status: "SKIPPED",
        reason: "already_processed",
        organizationId,
      }
    }

    console.error(`[MP webhook] Error inserting subscription_payment for org ${organizationId} (payment ${paymentId}):`, payInsertError)
    throw payInsertError
  }

  const paymentRecordId = insertedPayment?.id ?? null

  // Si no hay plan, el pago queda registrado pero la suscripción no se activa
  if (!targetPlan) {
    console.error(
      `[MP webhook] No target plan found for payment ${paymentId}, ` +
      `org=${organizationId}, ref_plan_id=${externalRef.plan_id ?? "none"}, ` +
      `ref_plan_slug=${externalRef.plan_slug ?? "none"}. ` +
      `Pago registrado (id=${paymentRecordId}) pero suscripción NO activada.`
    )
    return {
      status: "SKIPPED",
      reason: "plan_not_found",
      organizationId,
      subscriptionPaymentId: paymentRecordId,
    }
  }

  // --- PASO (b): Activar/renovar la suscripción ---
  const premiumPlan = targetPlan

  console.log(
    `[MP webhook] Resolved plan: id=${targetPlan.id}, slug=${targetPlan.slug} ` +
    `for payment ${paymentId}, org=${organizationId}`
  )

  try {
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

    // Actualizar subscription_id en el pago si no lo teníamos
    if (!subscriptionId) {
      const { data: newSub } = await supabaseAdmin
        .from("subscriptions")
        .select("id")
        .eq("organization_id", organizationId)
        .single()
      if (newSub && paymentRecordId) {
        await supabaseAdmin
          .from("subscription_payments")
          .update({ subscription_id: newSub.id })
          .eq("id", paymentRecordId)
      }
    }
  } catch (subActivationError) {
    // PASO (b) falló, pero el pago ya quedó registrado en PASO (a).
    // Marcamos la suscripción como PENDING_ACTIVATION para resolución manual.
    console.error(
      `[MP webhook] Subscription activation failed for org ${organizationId} (payment ${paymentId}). ` +
      `Pago registrado (id=${paymentRecordId}), suscripción pendiente de activación.`,
      subActivationError
    )

    // Intentar marcar la suscripción existente
    if (existingSub?.id) {
      try {
        await supabaseAdmin
          .from("subscriptions")
          .update({ status: "PAST_DUE" })
          .eq("id", existingSub.id)
      } catch {
        // ignorar si no se puede actualizar
      }
    }

    // El pago ya está registrado, retornamos PROCESSED porque el pago sí se guardó
    return {
      status: "PROCESSED",
      reason: "payment_registered_subscription_activation_failed",
      organizationId,
      subscriptionPaymentId: paymentRecordId,
    }
  }

  console.log(`[MP webhook] MercadoPago payment ${paymentId} processed for org ${organizationId}`)

  return {
    status: "PROCESSED",
    organizationId,
    subscriptionPaymentId: paymentRecordId,
  }
}

export async function handlePreApprovalNotification(
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

  let externalRef: {
    organization_id?: string
    plan_id?: string
    billing_period?: "MONTHLY" | "YEARLY"
  }
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

  const status = statusMap[preApproval.status]

  // Un estado que no conocemos no se traduce a ACTIVE por default: activar una
  // suscripcion por un estado que no entendemos es regalar el plan pago.
  if (!status) {
    console.log(`[MP webhook] PreApproval ${preApprovalId} en estado ${preApproval.status} - sin accion`)
    return { status: "SKIPPED", reason: `preapproval_status_${preApproval.status}`, organizationId }
  }

  // Se escribe el plan de la adhesion: sin esto la organizacion queda ACTIVE
  // sobre el plan que tuviera antes — adhiere al Profesional y sigue con los
  // limites del Free.
  //
  // NO se escribe current_period_start/end: el periodo lo fija el primer cobro,
  // que llega como subscription_authorized_payment. El guard de la Task 4 cubre
  // la adhesion cuyo cobro nunca llega.
  await supabaseAdmin
    .from("subscriptions")
    .update({
      status,
      plan_id: externalRef.plan_id ?? undefined,
      billing_period: externalRef.billing_period ?? undefined,
      payment_provider: "MERCADOPAGO",
      mercadopago_preapproval_id: preApprovalId,
    })
    .eq("organization_id", organizationId)

  console.log(`[MP webhook] PreApproval ${preApprovalId} updated to ${status}`)
  return { status: "PROCESSED", organizationId }
}

/**
 * Procesa una notificación `subscription_authorized_payment` (cobro recurrente
 * de una suscripción/preapproval).
 *
 * Por qué un handler separado: el `data.id` de este evento NO es un payment id
 * de `/v1/payments`, es un `authorized_payment` id que vive bajo el preapproval.
 * Antes mandábamos ese id a `handlePaymentNotification`, que hacía
 * `GET /v1/payments/{id}` y devolvía 404 → throw → webhook 500 → MP reintenta
 * 3x → suscripción nunca se renovaba sola.
 *
 * Flujo correcto:
 *   1. GET /authorized_payments/{id} → trae { payment: { id }, preapproval_id, status }
 *   2. Si status != "processed" (ej. "scheduled" / "recycling" / "rejected"),
 *      no hay nada que aplicar todavía
 *   3. GET /preapproval/{preapproval_id} → trae external_reference con
 *      organization_id / plan_id / plan_slug / billing_period (el payment hijo
 *      no carga external_reference)
 *   4. Delegar en handlePaymentNotification(realPaymentId, externalRef) para
 *      reusar idempotencia + activación/renovación.
 */
export async function handleAuthorizedPaymentNotification(
  authorizedPaymentId: string
): Promise<HandleResult> {
  if (!authorizedPaymentId) {
    return { status: "SKIPPED", reason: "missing_authorized_payment_id" }
  }

  const response = await fetch(
    `https://api.mercadopago.com/authorized_payments/${authorizedPaymentId}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
      },
    }
  )

  if (!response.ok) {
    const errText = await response.text()
    console.error(
      `[MP webhook] Error fetching authorized_payment ${authorizedPaymentId}:`,
      errText
    )
    throw new Error(
      `MP API error fetching authorized_payment ${authorizedPaymentId}: ${errText}`
    )
  }

  const authPayment = await response.json()

  // status posibles: scheduled | processed | recycling | rejected | cancelled.
  // Sólo "processed" significa que el cobro se concretó. El resto son ruido o
  // intentos fallidos que MP va a reintentar por su cuenta.
  if (authPayment.status !== "processed") {
    console.log(
      `[MP webhook] authorized_payment ${authorizedPaymentId} status=${authPayment.status} - ignorando`
    )
    return {
      status: "SKIPPED",
      reason: `authorized_payment_status_${authPayment.status}`,
    }
  }

  const realPaymentId = authPayment.payment?.id
  const preApprovalId = authPayment.preapproval_id

  if (!realPaymentId) {
    console.error(
      `[MP webhook] authorized_payment ${authorizedPaymentId} processed pero sin payment.id`
    )
    return {
      status: "SKIPPED",
      reason: "missing_payment_id_in_authorized_payment",
    }
  }

  if (!preApprovalId) {
    console.error(
      `[MP webhook] authorized_payment ${authorizedPaymentId} sin preapproval_id`
    )
    return { status: "SKIPPED", reason: "missing_preapproval_id" }
  }

  // El payment generado por una suscripción no carga external_reference,
  // por eso vamos al preapproval padre a buscarlo.
  const preApprovalRes = await fetch(
    `https://api.mercadopago.com/preapproval/${preApprovalId}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
      },
    }
  )

  if (!preApprovalRes.ok) {
    const errText = await preApprovalRes.text()
    console.error(
      `[MP webhook] Error fetching preapproval ${preApprovalId} (authorized_payment ${authorizedPaymentId}):`,
      errText
    )
    throw new Error(
      `MP API error fetching preapproval ${preApprovalId}: ${errText}`
    )
  }

  const preApproval = await preApprovalRes.json()

  let externalRef: PaymentExternalRef
  try {
    externalRef = JSON.parse(preApproval.external_reference || "{}")
  } catch {
    console.error(
      `[MP webhook] Invalid external_reference in preapproval ${preApprovalId}:`,
      preApproval.external_reference
    )
    return { status: "SKIPPED", reason: "invalid_external_reference" }
  }

  if (!externalRef.organization_id) {
    console.error(
      `[MP webhook] preapproval ${preApprovalId} sin organization_id en external_reference`
    )
    return { status: "SKIPPED", reason: "missing_organization_id" }
  }

  // Reusar handlePaymentNotification con el payment id real + external_ref
  // del preapproval. Idempotencia se mantiene: registra por provider_payment_id
  // y si ya existe, salta.
  return await handlePaymentNotification(String(realPaymentId), externalRef)
}

/**
 * Procesa una notificación IPN `merchant_order`.
 *
 * La merchant_order agrupa los pagos de una preferencia. Es redundante con el
 * topic=payment (que trae el paymentId directo), pero la procesamos por si
 * llega antes o si el topic=payment no llegara: buscamos la orden y delegamos
 * cada pago a handlePaymentNotification, que es idempotente y valida `approved`.
 *
 * Como en el resto del flujo IPN, la confianza viene del fetch autenticado a la
 * API de MP (con nuestro access token), no de la firma.
 */
export async function handleMerchantOrderNotification(
  merchantOrderId: string
): Promise<HandleResult> {
  if (!merchantOrderId) {
    return { status: "SKIPPED", reason: "missing_merchant_order_id" }
  }

  const response = await fetch(
    `https://api.mercadopago.com/merchant_orders/${merchantOrderId}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
      },
    }
  )

  if (!response.ok) {
    const errText = await response.text()
    console.error(
      `[MP webhook] Error fetching merchant_order ${merchantOrderId}:`,
      errText
    )
    throw new Error(
      `MP API error fetching merchant_order ${merchantOrderId}: ${errText}`
    )
  }

  const order = await response.json()
  const payments: Array<{ id: string | number }> = Array.isArray(order?.payments)
    ? order.payments
    : []

  if (payments.length === 0) {
    return { status: "SKIPPED", reason: "merchant_order_no_payments" }
  }

  // Delegamos cada pago al handler de pagos (idempotente + valida approved).
  // Devolvemos el último PROCESSED si lo hubo, si no el último resultado.
  let result: HandleResult = {
    status: "SKIPPED",
    reason: "merchant_order_no_processable_payments",
  }
  for (const p of payments) {
    const r = await handlePaymentNotification(String(p.id))
    if (r.status === "PROCESSED") result = r
    else if (result.status !== "PROCESSED") result = r
  }
  return result
}

// GET para verificación de webhook (algunos proveedores lo requieren)
export async function GET() {
  return NextResponse.json({ status: "ok" })
}
