import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { cancelPreApproval } from "@/lib/mercadopago"
import { cancelLemonSqueezySubscription } from "@/lib/lemonsqueezy"

export async function POST() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    // Obtener suscripción actual
    const { data: subscription, error: subError } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("organization_id", organizationId)
      .single()

    if (subError || !subscription) {
      return NextResponse.json(
        { error: "No hay suscripción activa" },
        { status: 404 }
      )
    }

    // Cancelar en el proveedor correspondiente
    if (subscription.mercadopago_preapproval_id) {
      await cancelPreApproval(subscription.mercadopago_preapproval_id)
    }

    if (subscription.lemonsqueezy_subscription_id) {
      await cancelLemonSqueezySubscription(subscription.lemonsqueezy_subscription_id)
    }

    // Actualizar en base de datos
    await supabaseAdmin
      .from("subscriptions")
      .update({
        cancel_at_period_end: true,
        canceled_at: new Date().toISOString(),
      })
      .eq("id", subscription.id)

    return NextResponse.json({
      success: true,
      message: "Suscripción cancelada. Tendrás acceso hasta el final del período actual.",
    })
  } catch (error) {
    console.error("Error canceling subscription:", error)
    return NextResponse.json(
      { error: "Error al cancelar suscripción" },
      { status: 500 }
    )
  }
}
