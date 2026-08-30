import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET() {
  try {
    // Historial de facturacion de la organizacion: select("*") sobre
    // subscription_payments (montos, fechas, medio de pago). El unico
    // consumidor es /configuracion/billing, que ya es admin-only.
    //
    // Ojo: /api/subscriptions y /api/subscriptions/usage NO se cierran. Los
    // consumen TrialCountdownBanner y UsageWarningBanner, montados en el
    // layout del dashboard para TODOS los roles, y subscription-required-view,
    // que es la pantalla de 'se vencio tu suscripcion'.
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { data, error: paymentsError } = await supabaseAdmin
      .from("subscription_payments")
      .select("*")
      .eq("organization_id", organizationId)
      .order("paid_at", { ascending: false })
      .order("created_at", { ascending: false })

    if (paymentsError) {
      console.error("Error fetching subscription payments:", paymentsError)
      return NextResponse.json(
        { error: "Error al obtener pagos" },
        { status: 500 }
      )
    }

    const payments =
      data?.map((payment) => ({
        id: payment.id,
        amount: Number(payment.amount),
        currency: payment.currency || "USD",
        status: payment.status,
        payment_provider: payment.payment_provider,
        invoice_url: payment.invoice_url,
        receipt_url: payment.receipt_url,
        paid_at: payment.paid_at || payment.created_at,
      })) || []

    return NextResponse.json({ payments })
  } catch (error) {
    console.error("Error returning subscription payments:", error)
    return NextResponse.json(
      { error: "Error al obtener pagos" },
      { status: 500 }
    )
  }
}
