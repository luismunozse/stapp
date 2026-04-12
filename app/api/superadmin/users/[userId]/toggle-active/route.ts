import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"

const toggleActiveSchema = z.object({
  activo: z.boolean(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { error: authError, email: adminEmail } = await requireSuperadmin()
    if (authError) return authError

    const { userId } = await params
    const parsed = await safeParseBody(request, toggleActiveSchema)
    if ("error" in parsed) return parsed.error
    const { activo } = parsed.data

    const { data: user, error: fetchError } = await supabaseAdmin
      .from("users")
      .select("id, nombre, email, email_verified, organization_id")
      .eq("id", userId)
      .single()

    if (fetchError || !user) {
      return NextResponse.json(
        { error: "Usuario no encontrado" },
        { status: 404 }
      )
    }

    // Desactivar = quitar email_verified, Activar = restaurarlo
    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({ email_verified: activo })
      .eq("id", userId)

    if (updateError) throw updateError

    await supabaseAdmin.from("audit_logs").insert({
      organization_id: user.organization_id,
      user_id: userId,
      action: "UPDATE",
      entity: "users",
      entity_id: userId,
      changes: {
        field: "email_verified",
        before: user.email_verified,
        after: activo,
        superadmin_email: adminEmail,
        action_description: activo
          ? `Usuario "${user.nombre}" (${user.email}) reactivado por superadmin`
          : `Usuario "${user.nombre}" (${user.email}) desactivado por superadmin`,
      },
    })

    return NextResponse.json({
      success: true,
      message: activo
        ? `Usuario ${user.nombre} reactivado`
        : `Usuario ${user.nombre} desactivado`,
    })
  } catch (error) {
    console.error("Error toggling user active:", error)
    return NextResponse.json(
      { error: "Error al cambiar estado del usuario" },
      { status: 500 }
    )
  }
}
