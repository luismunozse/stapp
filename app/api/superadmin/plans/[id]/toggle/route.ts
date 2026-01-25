import { NextRequest, NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const toggleSchema = z.object({
  activo: z.boolean(),
})

interface RouteParams {
  params: Promise<{
    id: string
  }>
}

/**
 * POST /api/superadmin/plans/[id]/toggle
 * Activa o desactiva un plan
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { error: authError, email } = await requireSuperadmin()
    if (authError) return authError

    const { id } = await params
    const body = await request.json()

    // Validar
    const validation = toggleSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        { error: "Datos inválidos" },
        { status: 400 }
      )
    }

    const { activo } = validation.data

    // Obtener plan actual
    const { data: plan, error: fetchError } = await supabaseAdmin
      .from("plans")
      .select("*, subscriptions(id, status)")
      .eq("id", id)
      .single()

    if (fetchError || !plan) {
      return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 })
    }

    // Si se intenta desactivar, verificar que no haya suscripciones activas
    if (!activo && plan.activo) {
      const activeSubscriptions = (plan.subscriptions as any[])?.filter(
        (sub) => sub.status === "ACTIVE"
      )

      if (activeSubscriptions && activeSubscriptions.length > 0) {
        return NextResponse.json(
          {
            error: `No se puede desactivar el plan. Hay ${activeSubscriptions.length} suscripción(es) activa(s) usando este plan.`,
          },
          { status: 400 }
        )
      }
    }

    // Configurar email del superadmin para trigger de auditoría
    await supabaseAdmin.rpc("set_config", {
      setting: "app.superadmin_email",
      value: email || "system",
    })

    // Actualizar estado
    const { data: updatedPlan, error: updateError } = await supabaseAdmin
      .from("plans")
      .update({ activo })
      .eq("id", id)
      .select()
      .single()

    if (updateError) {
      console.error("Error toggling plan:", updateError)
      return NextResponse.json(
        { error: "Error al cambiar estado del plan" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      plan: updatedPlan,
      message: `Plan "${updatedPlan.nombre}" ${activo ? "activado" : "desactivado"} exitosamente`,
    })
  } catch (error) {
    console.error("Error in POST /api/superadmin/plans/[id]/toggle:", error)
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    )
  }
}
