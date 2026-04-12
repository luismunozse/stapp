import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"
import { handlePaymentNotification } from "@/app/api/mercadopago/webhook/route"
import { beginWebhookEvent, finishWebhookEvent } from "@/lib/webhook-log"

/**
 * Reconciliación manual de un pago de MercadoPago.
 *
 * Caso de uso real: un cliente pagó por MP, el webhook (por la razón
 * que sea) no impactó, y vos terminaste activándole la suscripción
 * manualmente. Acá pegás el Payment ID de MP y el sistema:
 *
 *   1. Llama a la API real de MP para verificar el pago
 *   2. Re-ejecuta exactamente la misma lógica del webhook
 *      (handlePaymentNotification) que es idempotente: si ya fue
 *      procesado, no hace nada; si no, registra el pago, extiende
 *      la suscripción, etc.
 *   3. Deja un registro en webhook_events con status='PROCESSED'
 *      o 'SKIPPED' para que quede auditado quién reconcilió qué.
 *
 * Esto NO duplica un pago si ya estaba registrado — la idempotencia
 * vive en el handler del webhook (se valida por provider_payment_id).
 *
 * Si activaste manualmente con /superadmin/subscriptions/renew y
 * después corrés esto, el handler va a EXTENDER el período encima
 * del manual. Eso puede no ser lo que querés (doble extensión),
 * por eso pedimos confirmación explícita en el body con `force=true`
 * cuando ya hay una activación manual reciente.
 */

const reconcileSchema = z.object({
  paymentId: z
    .string()
    .min(1, "paymentId requerido")
    .max(64, "paymentId inválido"),
  /**
   * Si la org tiene una activación MANUAL en las últimas 24h, requerir
   * force=true para evitar extender doble. Default false.
   */
  force: z.boolean().optional().default(false),
})

// Cache de errores recientes para idempotencia en caso de fallo.
// Clave: paymentId, valor: { error response body, timestamp }
const recentErrorCache = new Map<string, { body: object; status: number; ts: number }>()
const ERROR_CACHE_TTL_MS = 60_000 // 60 segundos

function getRecentError(paymentId: string): { body: object; status: number } | null {
  const entry = recentErrorCache.get(paymentId)
  if (!entry) return null
  if (Date.now() - entry.ts > ERROR_CACHE_TTL_MS) {
    recentErrorCache.delete(paymentId)
    return null
  }
  return { body: entry.body, status: entry.status }
}

function cacheError(paymentId: string, body: object, status: number) {
  recentErrorCache.set(paymentId, { body, status, ts: Date.now() })
  // Limpieza periódica: eliminar entradas viejas si el map crece
  if (recentErrorCache.size > 200) {
    const now = Date.now()
    for (const [key, val] of recentErrorCache) {
      if (now - val.ts > ERROR_CACHE_TTL_MS) recentErrorCache.delete(key)
    }
  }
}

export async function POST(request: Request) {
  const { error: authError, email } = await requireSuperadmin()
  if (authError) return authError

  const parsed = await safeParseBody(request, reconcileSchema)
  if ("error" in parsed) return parsed.error

  const { paymentId, force } = parsed.data

  // Idempotencia de errores: si este paymentId ya falló en los últimos 60s,
  // devolver el error cacheado sin reprocesar.
  const cachedError = getRecentError(paymentId)
  if (cachedError) {
    return NextResponse.json(
      {
        ...cachedError.body,
        _cached: true,
        _message: "Este pago ya fue intentado recientemente y falló. Esperá 60 segundos antes de reintentar.",
      },
      { status: cachedError.status }
    )
  }

  // 1. Pre-fetch del pago para validar antes de tocar nada y para
  //    poder mostrar al superadmin el resumen del pago real de MP.
  let mpPayment: any = null
  try {
    const mpRes = await fetch(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
        },
      }
    )
    if (!mpRes.ok) {
      const txt = await mpRes.text()
      const errorBody = { error: "MercadoPago no encontró ese pago", detail: txt.slice(0, 500) }
      cacheError(paymentId, errorBody, 404)
      return NextResponse.json(errorBody, { status: 404 })
    }
    mpPayment = await mpRes.json()
  } catch (e) {
    const errorBody = { error: "Error consultando MercadoPago", detail: String(e) }
    cacheError(paymentId, errorBody, 502)
    return NextResponse.json(errorBody, { status: 502 })
  }

  // Resolver organization_id y slug desde el external_reference para los chequeos
  let organizationId: string | null = null
  let organizationSlug: string | null = null
  try {
    const ref = JSON.parse(mpPayment.external_reference || "{}")
    organizationId = ref.organization_id || null
  } catch {
    // dejará organizationId null y abajo el handler lo skipea
  }

  // Resolver slug de la organización para links en la UI
  if (organizationId) {
    const { data: orgData } = await supabaseAdmin
      .from("organizations")
      .select("slug")
      .eq("id", organizationId)
      .maybeSingle()
    organizationSlug = orgData?.slug ?? null
  }

  // 2. Si force=false, abortar cuando hubo activación MANUAL reciente
  //    para evitar doble extensión sin que el operador se entere.
  if (!force && organizationId) {
    const since = new Date()
    since.setHours(since.getHours() - 24)
    const { data: recentManual } = await supabaseAdmin
      .from("subscription_payments")
      .select("id, paid_at, amount")
      .eq("organization_id", organizationId)
      .eq("payment_provider", "MANUAL")
      .gte("paid_at", since.toISOString())
      .order("paid_at", { ascending: false })
      .limit(1)

    if (recentManual && recentManual.length > 0) {
      return NextResponse.json(
        {
          error: "manual_renewal_recent",
          message:
            "Esta organización tiene una renovación MANUAL en las últimas 24h. " +
            "Procesar este pago va a EXTENDER el período encima del manual " +
            "(doble extensión). Si querés continuar igual, reenviá con force=true.",
          recentManual: recentManual[0],
          organizationSlug,
        },
        { status: 409 }
      )
    }
  }

  // 3. Idempotencia explícita: si ya tenemos este pago registrado,
  //    devolvemos status 200 con info, sin volver a procesarlo.
  const { data: existingPayment } = await supabaseAdmin
    .from("subscription_payments")
    .select("id, organization_id, paid_at, amount, currency")
    .eq("provider_payment_id", String(paymentId))
    .eq("payment_provider", "MERCADOPAGO")
    .maybeSingle()

  if (existingPayment) {
    return NextResponse.json({
      success: true,
      already_processed: true,
      payment: existingPayment,
      message:
        "Este pago ya estaba registrado. No se hizo ningún cambio.",
    })
  }

  // 4. Verificar que la organización tenga un plan activo ANTES de procesar.
  //    Esto previene el error "Premium plan not found" que devolvía HTTP 500.
  if (organizationId) {
    const { data: activeSub } = await supabaseAdmin
      .from("subscriptions")
      .select("id, plan_id")
      .eq("organization_id", organizationId)
      .maybeSingle()

    // Verificar que exista al menos un plan PREMIUM activo en el sistema
    const { data: anyPremiumPlan } = await supabaseAdmin
      .from("plans")
      .select("id")
      .eq("tipo", "PREMIUM")
      .eq("activo", true)
      .limit(1)
      .maybeSingle()

    if (!anyPremiumPlan) {
      const errorBody = {
        error: "plan_not_found",
        message:
          "La organización no tiene un plan activo. Asigná un plan antes de reconciliar el pago.",
        organizationId,
        organizationSlug,
      }
      cacheError(paymentId, errorBody, 422)
      return NextResponse.json(errorBody, { status: 422 })
    }
  }

  console.log(
    `[reconcile-mp] Iniciando reconciliación: paymentId=${paymentId}, ` +
    `orgId=${organizationId ?? "unknown"}, mp_status=${mpPayment?.status}, ` +
    `mp_amount=${mpPayment?.transaction_amount}, superadmin=${email}`
  )

  // 5. Re-ejecutar la lógica del webhook. Logueamos como un evento
  //    con event_type='manual_reconciliation' para que se distinga
  //    de los webhooks reales en el panel.
  const log = await beginWebhookEvent({
    provider: "MERCADOPAGO",
    eventType: "manual_reconciliation",
    providerEventId: paymentId,
    payload: { mpPayment, reconciledBy: email, force },
    signatureValid: null,
  })

  try {
    const result = await handlePaymentNotification(paymentId)

    // Si el plan no se encontró, devolver 422 en vez de 500
    if (result.status === "SKIPPED" && result.reason === "plan_not_found") {
      await finishWebhookEvent(log, {
        status: "SKIPPED",
        httpStatus: 422,
        organizationId: result.organizationId ?? organizationId,
        errorMessage: "La organización no tiene un plan activo. Asigná un plan antes de reconciliar el pago.",
      })
      const errorBody = {
        error: "plan_not_found",
        message:
          "La organización no tiene un plan activo. Asigná un plan antes de reconciliar el pago.",
        organizationId: result.organizationId ?? organizationId,
        organizationSlug,
      }
      cacheError(paymentId, errorBody, 422)
      return NextResponse.json(errorBody, { status: 422 })
    }

    await finishWebhookEvent(log, {
      status: result.status === "PROCESSED" ? "PROCESSED" : "SKIPPED",
      httpStatus: 200,
      organizationId: result.organizationId ?? organizationId,
      subscriptionPaymentId: result.subscriptionPaymentId ?? null,
      errorMessage: result.reason ?? null,
    })

    // Auditar también en audit_logs para que aparezca en el historial
    // de la organización.
    if (result.organizationId) {
      await supabaseAdmin.from("audit_logs").insert({
        organization_id: result.organizationId,
        user_id: null,
        action: "UPDATE",
        entity: "subscription_payments",
        entity_id: result.subscriptionPaymentId ?? null,
        changes: {
          action: "manual_reconciliation_mp",
          mp_payment_id: paymentId,
          mp_status: mpPayment?.status,
          mp_amount: mpPayment?.transaction_amount,
          superadmin_email: email,
          handler_result: result.status,
          handler_reason: result.reason,
        },
      })
    }

    return NextResponse.json({
      success: true,
      result,
      organizationSlug,
      mpPayment: {
        id: mpPayment.id,
        status: mpPayment.status,
        amount: mpPayment.transaction_amount,
        currency: mpPayment.currency_id,
        date_approved: mpPayment.date_approved,
        external_reference: mpPayment.external_reference,
      },
    })
  } catch (e) {
    console.error("[reconcile-mp] error:", e)
    await finishWebhookEvent(log, {
      status: "ERROR",
      httpStatus: 500,
      organizationId,
      error: e,
    })
    const errorBody = {
      error: "Error procesando reconciliación",
      detail: String(e),
      organizationId,
      organizationSlug,
    }
    cacheError(paymentId, errorBody, 500)
    return NextResponse.json(errorBody, { status: 500 })
  }
}
