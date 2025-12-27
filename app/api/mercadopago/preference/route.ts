import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { createPaymentPreference } from "@/lib/mercadopago"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const preferenceSchema = z.object({
  billingPeriod: z.enum(["MONTHLY", "YEARLY"]).optional(),
})

export async function POST(request: NextRequest) {
  try {
    const { error, session, organizationId } = await requireAuth()
    if (error) return error

    const body = await request.json()
    const { billingPeriod = "MONTHLY" } = preferenceSchema.parse(body)

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

    // Crear preferencia de pago
    const preference = await createPaymentPreference({
      organizationId: org.id,
      organizationName: org.nombre,
      email: org.email || session?.user?.email || "",
      billingPeriod: billingPeriod as "MONTHLY" | "YEARLY",
      successUrl: `${baseUrl}/configuracion/billing?mp_success=true`,
      failureUrl: `${baseUrl}/configuracion/billing?mp_failure=true`,
      pendingUrl: `${baseUrl}/configuracion/billing?mp_pending=true`,
    })

    return NextResponse.json({
      preferenceId: preference.id,
      initPoint: preference.init_point,
      sandboxInitPoint: preference.sandbox_init_point,
    })
  } catch (error) {
    console.error("Error creating MercadoPago preference:", error)
    return NextResponse.json(
      { error: "Error al crear preferencia de pago" },
      { status: 500 }
    )
  }
}
