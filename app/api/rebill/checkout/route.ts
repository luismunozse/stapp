import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { createRebillCheckout } from "@/lib/rebill"
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

    const checkout = await createRebillCheckout({
      organizationId: org.id,
      organizationName: org.nombre,
      email: org.email || session?.user?.email || "",
      billingPeriod: billingPeriod as "MONTHLY" | "YEARLY",
      successUrl: `${baseUrl}/configuracion/billing?rebill_success=true`,
      failureUrl: `${baseUrl}/configuracion/billing?rebill_failure=true`,
    })

    return NextResponse.json({
      url: checkout.url,
      paymentLinkId: checkout.id,
    })
  } catch (error) {
    console.error("Error creating Rebill checkout:", error)
    return NextResponse.json(
      { error: "Error al crear checkout de pago" },
      { status: 500 }
    )
  }
}
