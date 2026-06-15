import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error: authError, email } = await requireSuperadmin()
    if (authError) return authError

    const { id } = await params
    const body = await request.json()
    const { activo, reason } = body

    if (typeof activo !== "boolean") {
      return NextResponse.json(
        { error: "El campo 'activo' es requerido y debe ser boolean" },
        { status: 400 }
      )
    }

    // Al suspender exigimos un motivo; al reactivar no aplica.
    const suspensionReason = typeof reason === "string" ? reason.trim() : ""
    if (!activo && !suspensionReason) {
      return NextResponse.json(
        { error: "Se requiere un motivo para suspender la organización" },
        { status: 400 }
      )
    }

    // Obtener estado anterior para el log
    const { data: orgBefore } = await supabaseAdmin
      .from("organizations")
      .select("activo, nombre, slug")
      .eq("id", id)
      .single()

    if (!orgBefore) {
      return NextResponse.json(
        { error: "Organización no encontrada" },
        { status: 404 }
      )
    }

    // Guard: nunca desactivar la org del panel admin
    if (orgBefore.slug === "superadmin") {
      return NextResponse.json(
        { error: "No se puede cambiar el estado de la organización del panel admin" },
        { status: 403 }
      )
    }

    // Actualizar estado. Al suspender guardamos motivo + quién/cuándo; al
    // reactivar limpiamos esos campos para no dejar un motivo viejo colgado.
    const { data, error: dbError } = await supabaseAdmin
      .from("organizations")
      .update({
        activo,
        suspension_reason: activo ? null : suspensionReason,
        suspended_at: activo ? null : new Date().toISOString(),
        suspended_by: activo ? null : email,
      })
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
        field: "activo",
        before: orgBefore.activo,
        after: activo,
        superadmin_email: email,
        suspension_reason: activo ? null : suspensionReason,
        action_description: activo
          ? `Organización "${orgBefore.nombre}" activada`
          : `Organización "${orgBefore.nombre}" desactivada — motivo: ${suspensionReason}`,
      },
    })

    return NextResponse.json({
      success: true,
      organization: data,
      message: activo
        ? "Organización activada correctamente"
        : "Organización desactivada correctamente",
    })
  } catch (error) {
    console.error("Error toggling organization status:", error)
    return NextResponse.json(
      { error: "Error al cambiar estado de organización" },
      { status: 500 }
    )
  }
}
