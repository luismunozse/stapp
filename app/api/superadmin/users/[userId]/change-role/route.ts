import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"
import { getPrincipalId } from "@/lib/sucursal"
import { isPlanLimitError, planLimitErrorResponse } from "@/lib/plan-limits"

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
      .select("id, nombre, email, rol, organization_id, sucursal_id")
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

    // Build the update payload, always including the new role.
    // Additionally manage sucursal_id to prevent cross-branch data leaks:
    //   - ADMIN must have sucursal_id = null (sees all branches via verTodas)
    //   - non-admin transitioning from ADMIN (sucursal_id null) must be assigned
    //     the org's principal branch; if none exists, reject the change
    //   - non-admin that already has a branch keeps it untouched
    const updates: Record<string, unknown> = { rol }

    if (rol === "ADMIN") {
      updates.sucursal_id = null
    } else if (user.sucursal_id === null) {
      // Non-admin with no branch: resolve the org's principal branch
      const principalId = await getPrincipalId(user.organization_id)
      if (!principalId) {
        return NextResponse.json(
          { error: "La organización no tiene sucursal principal" },
          { status: 400 }
        )
      }
      updates.sucursal_id = principalId
    }
    // else: non-admin already has a branch — leave sucursal_id untouched

    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update(updates)
      .eq("id", userId)

    // Desde la migración 323 el trigger de `tecnicos_count` corre también en
    // UPDATE, así que promover a alguien por encima del cupo de su plan ahora
    // levanta PLAN_LIMIT_EXCEEDED. Antes era imposible que llegara acá: el
    // trigger no veía los cambios de rol, y esa ceguera ERA el bug que la 323
    // vino a cerrar.
    //
    // Sin este chequeo el `throw` de abajo lo entrega como 500 "Error al
    // cambiar rol del usuario": el superadmin ve un fallo del sistema donde
    // hay una regla de negocio con nombre y número. Los helpers ya existían
    // para el alta; el cambio de rol es la segunda puerta al mismo límite.
    if (updateError) {
      if (isPlanLimitError(updateError)) {
        return planLimitErrorResponse(updateError)
      }
      throw updateError
    }

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
