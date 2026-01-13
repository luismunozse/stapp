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
    const { activo } = body

    if (typeof activo !== "boolean") {
      return NextResponse.json(
        { error: "El campo 'activo' es requerido y debe ser boolean" },
        { status: 400 }
      )
    }

    // Obtener estado anterior para el log
    const { data: orgBefore } = await supabaseAdmin
      .from("organizations")
      .select("activo, nombre")
      .eq("id", id)
      .single()

    if (!orgBefore) {
      return NextResponse.json(
        { error: "Organización no encontrada" },
        { status: 404 }
      )
    }

    // Actualizar estado
    const { data, error: dbError } = await supabaseAdmin
      .from("organizations")
      .update({ activo })
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
        action_description: activo
          ? `Organización "${orgBefore.nombre}" activada`
          : `Organización "${orgBefore.nombre}" desactivada`,
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
