import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { createSubscription } from "@/lib/mercadopago"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const preapprovalSchema = z.object({
  billingPeriod: z.enum(["MONTHLY", "YEARLY"]).optional(),
  planSlug: z.string().optional(),
})

/**
 * Crea una adhesion al debito automatico (PreApproval de MercadoPago).
 *
 * Ruta separada de /api/mercadopago/preference a proposito: son dos objetos
 * distintos de MercadoPago, con dos respuestas distintas y dos ciclos de vida
 * distintos. Mezclarlas obligaria al caller a adivinar que recibio.
 *
 * La organizacion sale SIEMPRE de la sesion, nunca del body: el monto y el plan
 * los decide el servidor.
 */
export async function POST(request: NextRequest) {
  try {
    const { error, session, organizationId } = await requireAuth()
    if (error) return error

    const body = await request.json()
    const { billingPeriod = "MONTHLY", planSlug } = preapprovalSchema.parse(body)

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

    const preApproval = await createSubscription({
      organizationId: org.id,
      organizationName: org.nombre,
      email: org.email || session?.user?.email || "",
      billingPeriod: billingPeriod as "MONTHLY" | "YEARLY",
      backUrl: `${baseUrl}/configuracion/billing?mp_adhesion=true`,
      planSlug,
    })

    return NextResponse.json({
      preapprovalId: preApproval.id,
      initPoint: preApproval.init_point,
    })
  } catch (error) {
    console.error("Error creando adhesión de MercadoPago:", error)
    return NextResponse.json(
      { error: "Error al crear la adhesión al débito automático" },
      { status: 500 }
    )
  }
}
