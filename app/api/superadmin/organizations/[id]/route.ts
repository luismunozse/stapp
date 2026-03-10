import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"
import type { OrganizationDetailResponse, PaymentWithOrg } from "@/types/superadmin"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { id } = await params

    const [orgResult, usersResult, usageResult, subscriptionResult] =
      await Promise.all([
        // Organización
        supabaseAdmin
          .from("organizations")
          .select("*")
          .eq("id", id)
          .single(),

        // Usuarios
        supabaseAdmin
          .from("users")
          .select("id, nombre, email, rol, email_verified, created_at")
          .eq("organization_id", id)
          .order("created_at", { ascending: false }),

        // Uso
        supabaseAdmin
          .from("organization_usage")
          .select("*")
          .eq("organization_id", id)
          .single(),

        // Suscripción con plan
        supabaseAdmin
          .from("subscriptions")
          .select(
            `
            *,
            plans (*)
          `
          )
          .eq("organization_id", id)
          .single(),
      ])

    if (orgResult.error || !orgResult.data) {
      return NextResponse.json(
        { error: "Organización no encontrada" },
        { status: 404 }
      )
    }

    // Obtener pagos si hay suscripción
    let payments: PaymentWithOrg[] = []
    if (subscriptionResult.data?.id) {
      const { data: paymentsData } = await supabaseAdmin
        .from("subscription_payments")
        .select("*")
        .eq("subscription_id", subscriptionResult.data.id)
        .order("paid_at", { ascending: false })
        .limit(10)

      payments = paymentsData || []
    }

    const response: OrganizationDetailResponse = {
      organization: orgResult.data,
      users: usersResult.data || [],
      usage: usageResult.data || null,
      subscription: subscriptionResult.data || null,
      payments,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error("Error fetching organization detail:", error)
    return NextResponse.json(
      { error: "Error al obtener detalle de organización" },
      { status: 500 }
    )
  }
}

const updateOrgSchema = z.object({
  nombre: z.string().min(1).optional(),
  nombre_mostrar: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  telefono: z.string().nullable().optional(),
  direccion: z.string().nullable().optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: "Se requiere al menos un campo para actualizar",
})

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error: authError, email } = await requireSuperadmin()
    if (authError) return authError

    const { id } = await params
    const parsed = await safeParseBody(request, updateOrgSchema)
    if ("error" in parsed) return parsed.error
    const updateData = parsed.data

    const { data, error: dbError } = await supabaseAdmin
      .from("organizations")
      .update(updateData)
      .eq("id", id)
      .select()
      .single()

    if (dbError) throw dbError

    // Registrar en audit_logs
    await supabaseAdmin.from("audit_logs").insert({
      organization_id: id,
      user_id: null,
      action: "UPDATE",
      entity: "organizations",
      entity_id: id,
      changes: {
        updated_fields: Object.keys(updateData),
        superadmin_email: email,
      },
    })

    return NextResponse.json(data)
  } catch (error) {
    console.error("Error updating organization:", error)
    return NextResponse.json(
      { error: "Error al actualizar organización" },
      { status: 500 }
    )
  }
}
