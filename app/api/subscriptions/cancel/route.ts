import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { cancelPreApproval } from "@/lib/mercadopago"
import { cancelRebillSubscription } from "@/lib/rebill"
import { cancelCreemSubscription } from "@/lib/creem"

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

    // Cancelar en cada proveedor con id registrado, aislando fallos: un id
    // viejo de un proveedor anterior no debe impedir cancelar en el que
    // realmente está cobrando.
    const cancelaciones: Array<[string, () => Promise<unknown>]> = []
    if (subscription.mercadopago_preapproval_id) {
      cancelaciones.push([
        "MERCADOPAGO",
        () => cancelPreApproval(subscription.mercadopago_preapproval_id),
      ])
    }
    if (subscription.rebill_subscription_id) {
      cancelaciones.push([
        "REBILL",
        () => cancelRebillSubscription(subscription.rebill_subscription_id),
      ])
    }
    if (subscription.creem_subscription_id) {
      cancelaciones.push([
        "CREEM",
        () => cancelCreemSubscription(subscription.creem_subscription_id),
      ])
    }

    const proveedoresFallidos: string[] = []
    for (const [proveedor, cancelar] of cancelaciones) {
      try {
        await cancelar()
      } catch (err) {
        console.error(`Error canceling subscription in ${proveedor}:`, err)
        proveedoresFallidos.push(proveedor)
      }
    }

    if (proveedoresFallidos.length > 0) {
      return NextResponse.json(
        { error: "Error al cancelar suscripción", providers: proveedoresFallidos },
        { status: 500 }
      )
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
