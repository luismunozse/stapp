import { NextRequest, NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"
import type { UpdatePlanInput } from "@/types/superadmin"

// Schema de validación para actualizar plan
const updatePlanSchema = z.object({
  nombre: z.string().min(2).max(50).optional(),
  descripcion: z.string().max(500).nullable().optional(),
  precio_mensual: z.number().min(0).optional(),
  precio_anual: z.number().min(0).optional(),
  limite_ordenes: z.number().positive().nullable().optional(),
  limite_tecnicos: z.number().positive().nullable().optional(),
  limite_clientes: z.number().positive().nullable().optional(),
  limite_vendedores: z.number().positive().nullable().optional(),
  limite_storage_mb: z.number().positive().nullable().optional(),
  features: z.array(z.string()).optional(),
})

interface RouteParams {
  params: Promise<{
    id: string
  }>
}

/**
 * GET /api/superadmin/plans/[id]
 * Obtiene detalle de un plan específico
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { error: authError } = await requireSuperadmin()
    if (authError) return authError

    const { id } = await params

    const { data: plan, error } = await supabaseAdmin
      .from("plans_with_usage")
      .select("*")
      .eq("id", id)
      .single()

    if (error || !plan) {
      return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 })
    }

    return NextResponse.json({ plan })
  } catch (error) {
    console.error("Error in GET /api/superadmin/plans/[id]:", error)
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/superadmin/plans/[id]
 * Actualiza un plan existente
 */
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { error: authError, email } = await requireSuperadmin()
    if (authError) return authError

    const { id } = await params
    const body = await request.json()

    // Validar con Zod
    const validation = updatePlanSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Datos inválidos",
          details: validation.error.flatten().fieldErrors,
        },
        { status: 400 }
      )
    }

    const data: UpdatePlanInput = validation.data

    // Obtener plan actual
    const { data: currentPlan, error: fetchError } = await supabaseAdmin
      .from("plans")
      .select("*")
      .eq("id", id)
      .single()

    if (fetchError || !currentPlan) {
      return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 })
    }

    // Validación: Si es plan FREE, NO permitir precios > 0
    if (currentPlan.tipo === "FREE") {
      if (
        (data.precio_mensual !== undefined && data.precio_mensual > 0) ||
        (data.precio_anual !== undefined && data.precio_anual > 0)
      ) {
        return NextResponse.json(
          { error: "Plan FREE no puede tener precios mayores a 0" },
          { status: 400 }
        )
      }
    }

    // NUNCA permitir cambiar el tipo del plan (inmutable)
    // El tipo NO está en UpdatePlanInput, pero validar por seguridad
    if ("tipo" in body) {
      return NextResponse.json(
        { error: "No se puede cambiar el tipo del plan (FREE/PREMIUM es inmutable)" },
        { status: 400 }
      )
    }

    // Configurar email del superadmin para trigger de auditoría
    await supabaseAdmin.rpc("set_config", {
      setting: "app.superadmin_email",
      value: email || "system",
    })

    // Actualizar el plan
    const { data: updatedPlan, error: updateError } = await supabaseAdmin
      .from("plans")
      .update(data)
      .eq("id", id)
      .select()
      .single()

    if (updateError) {
      console.error("Error updating plan:", updateError)
      return NextResponse.json(
        { error: "Error al actualizar el plan" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      plan: updatedPlan,
      message: `Plan "${updatedPlan.nombre}" actualizado exitosamente`,
    })
  } catch (error) {
    console.error("Error in PATCH /api/superadmin/plans/[id]:", error)
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    )
  }
}
