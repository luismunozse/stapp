import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { createLemonSqueezyCheckout } from "@/lib/lemonsqueezy"
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

    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000"

    // Crear checkout de LemonSqueezy
    const checkout = await createLemonSqueezyCheckout({
      organizationId: org.id,
      organizationName: org.nombre,
      email: org.email || session?.user?.email || "",
      billingPeriod: billingPeriod as "MONTHLY" | "YEARLY",
      successUrl: `${baseUrl}/configuracion/billing?ls_success=true`,
    })

    const checkoutUrl = checkout?.data?.attributes?.url

    if (!checkoutUrl) {
      throw new Error("No checkout URL returned")
    }

    return NextResponse.json({
      url: checkoutUrl,
    })
  } catch (err) {
    console.error("Error creating LemonSqueezy checkout:", err)
    return NextResponse.json(
      { error: "Error al crear sesión de pago" },
      { status: 500 }
    )
  }
}
