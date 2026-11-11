import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { createSuperadminAuditLogger } from "@/lib/superadmin-audit"
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

    // Auditoría fail-closed ANTES de cambiar el acceso del usuario.
    const intento = await createSuperadminAuditLogger(adminEmail, request).exigir({
      action: "TOGGLE_STATUS",
      entity: "users",
      entityId: userId,
      organizationId: user.organization_id,
      description: activo
        ? `Usuario "${user.nombre}" (${user.email}) reactivado por superadmin`
        : `Usuario "${user.nombre}" (${user.email}) desactivado por superadmin`,
      metadata: { field: "email_verified", before: user.email_verified, after: activo, userEmail: user.email },
    })
    if (!intento.ok) return intento.respuesta

    // Desactivar = quitar email_verified, Activar = restaurarlo
    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({ email_verified: activo })
      .eq("id", userId)

    if (updateError) {
      await intento.completar({ error: updateError.message }, "fallido")
      throw updateError
    }

    await intento.completar()

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
