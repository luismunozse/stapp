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
/**
 * MercadoPago exige que back_url sea una URL publica: con localhost la API de
 * PreApproval responde 400 "Invalid value for back_url".
 *
 * En desarrollo NEXTAUTH_URL vale http://localhost:3000, asi que este flujo NO
 * se puede probar en local sin apuntarla a un dominio publico. Se corta antes
 * con un mensaje que dice que pasa, en vez de dejar que el operador reciba el
 * 400 opaco de MercadoPago y no sepa que mirar.
 */
function esUrlPublica(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url)
    if (protocol !== "https:" && protocol !== "http:") return false
    return hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1"
  } catch {
    return false
  }
}

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

    if (!esUrlPublica(baseUrl)) {
      console.error(
        `[preapproval] NEXTAUTH_URL no es una URL publica (${baseUrl}): MercadoPago rechaza el back_url`
      )
      return NextResponse.json(
        {
          error:
            "La adhesión al débito automático necesita una URL pública de retorno. Revisá NEXTAUTH_URL.",
        },
        { status: 500 }
      )
    }

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
