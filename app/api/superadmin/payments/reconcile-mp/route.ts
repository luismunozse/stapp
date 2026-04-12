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

export async function POST(request: Request) {
  const { error: authError, email } = await requireSuperadmin()
  if (authError) return authError

  const parsed = await safeParseBody(request, reconcileSchema)
  if ("error" in parsed) return parsed.error

  const { paymentId, force } = parsed.data

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
      return NextResponse.json(
        { error: "MercadoPago no encontró ese pago", detail: txt.slice(0, 500) },
        { status: 404 }
      )
    }
    mpPayment = await mpRes.json()
  } catch (e) {
    return NextResponse.json(
      { error: "Error consultando MercadoPago", detail: String(e) },
      { status: 502 }
    )
  }

  // Resolver organization_id desde el external_reference para los chequeos
  let organizationId: string | null = null
  try {
    const ref = JSON.parse(mpPayment.external_reference || "{}")
    organizationId = ref.organization_id || null
  } catch {
    // dejará organizationId null y abajo el handler lo skipea
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

  console.log(
    `[reconcile-mp] Iniciando reconciliación: paymentId=${paymentId}, ` +
    `orgId=${organizationId ?? "unknown"}, mp_status=${mpPayment?.status}, ` +
    `mp_amount=${mpPayment?.transaction_amount}, superadmin=${email}`
  )

  // 4. Re-ejecutar la lógica del webhook. Logueamos como un evento
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

    // Si el plan no se encontró, devolver 400 en vez de 500
    if (result.status === "SKIPPED" && result.reason === "plan_not_found") {
      await finishWebhookEvent(log, {
        status: "SKIPPED",
        httpStatus: 400,
        organizationId: result.organizationId ?? organizationId,
        errorMessage: "No se encontró un plan válido para asignar a esta organización",
      })
      return NextResponse.json(
        {
          error: "plan_not_found",
          message:
            "No se encontró un plan Premium válido para esta organización. " +
            "Verificá que exista al menos un plan activo con tipo PREMIUM en la tabla plans.",
          organizationId: result.organizationId,
        },
        { status: 400 }
      )
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
    return NextResponse.json(
      { error: "Error procesando reconciliación", detail: String(e) },
      { status: 500 }
    )
  }
}
