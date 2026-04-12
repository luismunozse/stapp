import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { sendPasswordResetEmail } from "@/lib/email"
import { randomBytes } from "crypto"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { error: authError, email: adminEmail } = await requireSuperadmin()
    if (authError) return authError

    const { userId } = await params

    const { data: user, error: fetchError } = await supabaseAdmin
      .from("users")
      .select("id, email, nombre, organization_id, organizations!inner(slug)")
      .eq("id", userId)
      .single()

    if (fetchError || !user) {
      return NextResponse.json(
        { error: "Usuario no encontrado" },
        { status: 404 }
      )
    }

    const resetToken = randomBytes(32).toString("hex")
    const resetTokenExpiry = new Date(Date.now() + 3600000).toISOString()

    await supabaseAdmin
      .from("users")
      .update({ reset_token: resetToken, reset_token_expiry: resetTokenExpiry })
      .eq("id", userId)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const org = (user as any).organizations as { slug: string }

    await sendPasswordResetEmail({
      email: user.email,
      token: resetToken,
      nombre: user.nombre,
      slug: org.slug,
    })

    await supabaseAdmin.from("audit_logs").insert({
      organization_id: user.organization_id,
      user_id: userId,
      action: "UPDATE",
      entity: "users",
      entity_id: userId,
      changes: {
        field: "password_reset",
        superadmin_email: adminEmail,
        action_description: `Reset de contraseña enviado a "${user.nombre}" (${user.email}) por superadmin`,
      },
    })

    return NextResponse.json({
      success: true,
      message: `Email de reset enviado a ${user.email}`,
    })
  } catch (error) {
    console.error("Error resetting password:", error)
    return NextResponse.json(
      { error: "Error al enviar reset de contraseña" },
      { status: 500 }
    )
  }
}
