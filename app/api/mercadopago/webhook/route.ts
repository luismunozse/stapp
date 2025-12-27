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
    console.error("Error fetching payment:", await response.text())
    return
  }

  const payment = await response.json()

  // Extraer external_reference
  let externalRef
  try {
    externalRef = JSON.parse(payment.external_reference || "{}")
  } catch {
    console.error("Invalid external_reference:", payment.external_reference)
    return
  }

  const organizationId = externalRef.organization_id
  if (!organizationId) {
    console.error("No organization_id in payment external_reference")
    return
  }

  // Validar que la organización exista y esté activa
  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("id, activo")
    .eq("id", organizationId)
    .single()

  if (!org || org.activo === false) {
    console.error(`Organization ${organizationId} not found or inactive`)
    return
  }

  // Solo procesar pagos aprobados
  if (payment.status !== "approved") {
    console.log(`Payment ${paymentId} status: ${payment.status}`)
    return
  }

  // Obtener plan Premium
  const { data: premiumPlan } = await supabaseAdmin
    .from("plans")
    .select("id")
    .eq("tipo", "PREMIUM")
    .single()

  if (!premiumPlan) {
    console.error("Premium plan not found")
    return
  }

  // Calcular período
  const billingPeriod = externalRef.billing_period || "MONTHLY"
  const periodMonths = billingPeriod === "YEARLY" ? 12 : 1
  const periodEnd = new Date()
  periodEnd.setMonth(periodEnd.getMonth() + periodMonths)

  // Actualizar o crear suscripción
  await supabaseAdmin
    .from("subscriptions")
    .upsert({
      organization_id: organizationId,
      plan_id: premiumPlan.id,
      status: "ACTIVE",
      billing_period: billingPeriod,
      payment_provider: "MERCADOPAGO",
      mercadopago_payer_id: payment.payer?.id?.toString() || null,
      current_period_start: new Date().toISOString(),
      current_period_end: periodEnd.toISOString(),
    }, {
      onConflict: "organization_id",
    })

  // Obtener suscripción para guardar pago
  const { data: subscription } = await supabaseAdmin
    .from("subscriptions")
    .select("id")
    .eq("organization_id", organizationId)
    .single()

  if (subscription) {
    // Registrar pago
    await supabaseAdmin.from("subscription_payments").insert({
      subscription_id: subscription.id,
      organization_id: organizationId,
      amount: payment.transaction_amount,
      currency: payment.currency_id,
      payment_provider: "MERCADOPAGO",
      provider_payment_id: paymentId,
      status: "SUCCEEDED",
      paid_at: new Date(payment.date_approved).toISOString(),
    })
  }

  console.log(`MercadoPago payment ${paymentId} processed for org ${organizationId}`)
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
