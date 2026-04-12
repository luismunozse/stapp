import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"

const changeRoleSchema = z.object({
  rol: z.enum(["ADMIN", "TECNICO", "VENDEDOR"]),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { error: authError, email: adminEmail } = await requireSuperadmin()
    if (authError) return authError

    const { userId } = await params
    const parsed = await safeParseBody(request, changeRoleSchema)
    if ("error" in parsed) return parsed.error
    const { rol } = parsed.data

    const { data: user, error: fetchError } = await supabaseAdmin
      .from("users")
      .select("id, nombre, email, rol, organization_id")
      .eq("id", userId)
      .single()

    if (fetchError || !user) {
      return NextResponse.json(
        { error: "Usuario no encontrado" },
        { status: 404 }
      )
    }

    if (user.rol === rol) {
      return NextResponse.json(
        { error: `El usuario ya tiene el rol ${rol}` },
        { status: 400 }
      )
    }

    const previousRole = user.rol

    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({ rol })
      .eq("id", userId)

    if (updateError) throw updateError

    await supabaseAdmin.from("audit_logs").insert({
      organization_id: user.organization_id,
      user_id: userId,
      action: "UPDATE",
      entity: "users",
      entity_id: userId,
      changes: {
        field: "rol",
        before: previousRole,
        after: rol,
        superadmin_email: adminEmail,
        action_description: `Rol de "${user.nombre}" cambiado de ${previousRole} a ${rol} por superadmin`,
      },
    })

    return NextResponse.json({
      success: true,
      message: `Rol de ${user.nombre} cambiado a ${rol}`,
    })
  } catch (error) {
    console.error("Error changing user role:", error)
    return NextResponse.json(
      { error: "Error al cambiar rol del usuario" },
      { status: 500 }
    )
  }
}
