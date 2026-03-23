import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { error: authError, email } = await requireSuperadmin()
    if (authError) return authError

    const { userId } = await params

    // Obtener usuario actual
    const { data: user, error: fetchError } = await supabaseAdmin
      .from("users")
      .select("id, email, nombre, email_verified, organization_id")
      .eq("id", userId)
      .single()

    if (fetchError || !user) {
      return NextResponse.json(
        { error: "Usuario no encontrado" },
        { status: 404 }
      )
    }

    if (user.email_verified) {
      return NextResponse.json(
        { error: "El usuario ya tiene el email verificado" },
        { status: 400 }
      )
    }

    // Activar verificación de email
    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({
        email_verified: true,
        email_verification_token: null,
        email_verification_expires: null,
      })
      .eq("id", userId)

    if (updateError) throw updateError

    // Registrar en audit_logs
    await supabaseAdmin.from("audit_logs").insert({
      organization_id: user.organization_id,
      user_id: userId,
      action: "UPDATE",
      entity: "users",
      entity_id: userId,
      changes: {
        field: "email_verified",
        before: false,
        after: true,
        superadmin_email: email,
        action_description: `Email de "${user.nombre}" (${user.email}) verificado manualmente por superadmin`,
      },
    })

    return NextResponse.json({
      success: true,
      message: `Email de ${user.nombre} verificado correctamente`,
    })
  } catch (error) {
    console.error("Error verifying user email:", error)
    return NextResponse.json(
      { error: "Error al verificar email del usuario" },
      { status: 500 }
    )
  }
}
