import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { createCheckoutSession, STRIPE_PRICES } from "@/lib/stripe"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const checkoutSchema = z.object({
  billingPeriod: z.enum(["MONTHLY", "YEARLY"]).optional(),
})

export async function POST(request: NextRequest) {
  try {
    const { error, session, organizationId } = await requireAuth()
    if (error) return error

    const body = await request.json()
    const { billingPeriod = "MONTHLY" } = checkoutSchema.parse(body)

    // Obtener datos de la organización
    const { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .select("id, nombre, email, activo")
      .eq("id", organizationId)
      .single()

    if (orgError || !org || org.activo === false) {
      return NextResponse.json(
        { error: "Organización no encontrada o inactiva" },
        { status: 404 }
      )
    }

    // Seleccionar precio según período
    const priceId =
      billingPeriod === "YEARLY" ? STRIPE_PRICES.YEARLY : STRIPE_PRICES.MONTHLY

    if (!priceId) {
      return NextResponse.json(
        { error: "Precio no configurado" },
        { status: 500 }
      )
    }

    // Crear sesión de checkout
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000"
    const checkoutSession = await createCheckoutSession({
      organizationId: org.id,
      organizationName: org.nombre,
      email: org.email || session?.user?.email || "",
      priceId,
      successUrl: `${baseUrl}/configuracion/billing?success=true`,
      cancelUrl: `${baseUrl}/configuracion/billing?canceled=true`,
    })

    return NextResponse.json({ url: checkoutSession.url })
  } catch (error) {
    console.error("Error creating checkout session:", error)
    return NextResponse.json(
      { error: "Error al crear sesión de pago" },
      { status: 500 }
    )
  }
}
