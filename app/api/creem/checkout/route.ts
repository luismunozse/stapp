import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { z } from "zod"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { createCreemCheckout } from "@/lib/creem"

/**
 * Crea un checkout de Creem (cobro internacional en USD) para la org del
 * usuario autenticado. Devuelve la checkout_url hosteada de Creem.
 *
 * El plan x período se mapea al product_id de Creem guardado en
 * plans.creem_product_id_monthly / _yearly. El organization_id viaja en el
 * metadata para que el webhook pueda reconciliar el pago.
 */
const checkoutSchema = z.object({
  billingPeriod: z.enum(["MONTHLY", "YEARLY"]).optional(),
  planSlug: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const { error, session, organizationId } = await requireAuth()
  if (error) return error

  const body = await request.json().catch(() => ({}))
  const { billingPeriod = "MONTHLY", planSlug = "profesional" } =
    checkoutSchema.parse(body)

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

  const { data: plan } = await supabaseAdmin
    .from("plans")
    .select("id, slug, creem_product_id_monthly, creem_product_id_yearly")
    .eq("slug", planSlug)
    .maybeSingle()

  if (!plan) {
    return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 })
  }

  const productId =
    billingPeriod === "YEARLY"
      ? plan.creem_product_id_yearly
      : plan.creem_product_id_monthly

  if (!productId) {
    return NextResponse.json(
      {
        error:
          "Este plan no está disponible para pago internacional todavía. Configurá el producto en Creem.",
      },
      { status: 422 }
    )
  }

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000"

  try {
    const checkout = await createCreemCheckout({
      productId,
      requestId: randomUUID(),
      email: org.email || session?.user?.email || null,
      successUrl: `${baseUrl}/configuracion/billing?creem_success=true`,
      metadata: {
        organization_id: org.id,
        plan_id: plan.id,
        plan_slug: plan.slug ?? planSlug,
        billing_period: billingPeriod,
      },
    })

    return NextResponse.json({ checkoutUrl: checkout.checkoutUrl })
  } catch (e) {
    console.error("[creem-checkout] Error creando checkout:", e)
    return NextResponse.json(
      { error: "Error al crear el checkout de Creem" },
      { status: 500 }
    )
  }
}
