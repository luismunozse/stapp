import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { verifyWebhookSignature } from "@/lib/mercadopago"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const xSignature = request.headers.get("x-signature")
    const xRequestId = request.headers.get("x-request-id")

    // Verificar firma (en producción)
    if (process.env.NODE_ENV === "production") {
      const isValid = verifyWebhookSignature(
        xSignature,
        xRequestId,
        body.data?.id || ""
      )

      if (!isValid) {
        console.error("Invalid MercadoPago webhook signature")
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
      }
    }

    const { type, data } = body

    switch (type) {
      case "payment":
        await handlePaymentNotification(data.id)
        break

      case "subscription_preapproval":
        await handlePreApprovalNotification(data.id)
        break

      case "subscription_authorized_payment":
        await handleAuthorizedPayment(data.id)
        break

      default:
        console.log(`Unhandled MercadoPago event type: ${type}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error("Error processing MercadoPago webhook:", error)
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    )
  }
}

async function handlePaymentNotification(paymentId: string) {
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
  let externalRef: { organization_id?: string; billing_period?: string }
  try {
    externalRef = JSON.parse(payment.external_reference || "{}")
  } catch {
    console.error(`[MP webhook] Invalid external_reference for payment ${paymentId}:`, payment.external_reference)
    return
  }

  const organizationId = externalRef.organization_id
  if (!organizationId) {
    console.error(`[MP webhook] No organization_id in external_reference for payment ${paymentId}`)
    return
  }

  // Validar que la organización exista y esté activa
  const { data: org, error: orgError } = await supabaseAdmin
    .from("organizations")
    .select("id, activo")
    .eq("id", organizationId)
    .single()

  if (orgError || !org || org.activo === false) {
    console.error(`[MP webhook] Organization ${organizationId} not found or inactive (payment ${paymentId})`, orgError)
    return
  }

  // Solo procesar pagos aprobados
  if (payment.status !== "approved") {
    console.log(`[MP webhook] Payment ${paymentId} status: ${payment.status} - ignorando`)
    return
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
    return
  }

  // Obtener plan Premium
  const { data: premiumPlan, error: planError } = await supabaseAdmin
    .from("plans")
    .select("id")
    .eq("tipo", "PREMIUM")
    .single()

  if (planError || !premiumPlan) {
    console.error(`[MP webhook] Premium plan not found (payment ${paymentId})`, planError)
    throw new Error("Premium plan not found")
  }

  // Calcular período: si la suscripción está activa y vigente, EXTENDER desde el final actual
  const billingPeriod = externalRef.billing_period || "MONTHLY"
  const periodMonths = billingPeriod === "YEARLY" ? 12 : 1
  const now = new Date()

  const { data: existingSub } = await supabaseAdmin
    .from("subscriptions")
    .select("id, status, current_period_end")
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
  const { error: payInsertError } = await supabaseAdmin
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

  if (payInsertError) {
    console.error(`[MP webhook] Error inserting subscription_payment for org ${organizationId} (payment ${paymentId}):`, payInsertError)
    throw payInsertError
  }

  console.log(`[MP webhook] MercadoPago payment ${paymentId} processed for org ${organizationId}`)
}

async function handlePreApprovalNotification(preApprovalId: string) {
  // Obtener detalles de la suscripción
  const response = await fetch(
    `https://api.mercadopago.com/preapproval/${preApprovalId}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
      },
    }
  )

  if (!response.ok) {
    console.error("Error fetching preapproval:", await response.text())
    return
  }

  const preApproval = await response.json()

  let externalRef
  try {
    externalRef = JSON.parse(preApproval.external_reference || "{}")
  } catch {
    return
  }

  const organizationId = externalRef.organization_id
  if (!organizationId) return

  // Mapear estado
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

  console.log(`PreApproval ${preApprovalId} updated to ${status}`)
}

async function handleAuthorizedPayment(paymentId: string) {
  // Manejar pagos automáticos de suscripción
  await handlePaymentNotification(paymentId)
}

// GET para verificación de webhook (algunos proveedores lo requieren)
export async function GET() {
  return NextResponse.json({ status: "ok" })
}
