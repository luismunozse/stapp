import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { createBillingPortalSession } from "@/lib/stripe"
import { supabaseAdmin } from "@/lib/supabase"

export async function POST() {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    // Obtener suscripción de la organización
    const { data: subscription, error: subError } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("organization_id", organizationId)
      .single()

    if (subError || !subscription?.stripe_customer_id) {
      return NextResponse.json(
        { error: "No hay suscripción activa con Stripe" },
        { status: 404 }
      )
    }

    // Crear sesión del portal
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000"
    const portalSession = await createBillingPortalSession({
      customerId: subscription.stripe_customer_id,
      returnUrl: `${baseUrl}/configuracion/billing`,
    })

    return NextResponse.json({ url: portalSession.url })
  } catch (error) {
    console.error("Error creating billing portal session:", error)
    return NextResponse.json(
      { error: "Error al crear sesión del portal" },
      { status: 500 }
    )
  }
}
