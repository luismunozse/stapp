import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"
import { invalidateRefreshToken } from "@/lib/auth-tokens"

const toggleActiveSchema = z.object({
  activo: z.boolean(),
})

/**
 * Bloquea o habilita el acceso de un usuario (users.acceso_bloqueado_at, 395).
 *
 * Antes "desactivar" ponía email_verified = false: el login con Google lo
 * volvía a true, reenviar la verificación lo reactivaba y las sesiones
 * abiertas seguían. Ahora el bloqueo lo revisan los tres modos de login, la
 * revalidación de la sesión y el proxy (que corta la sesión viva en ~30 s), y
 * además se revocan sus refresh tokens. email_verified no se toca.
 */
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
      .select("id, nombre, email, organization_id, acceso_bloqueado_at, es_superadmin")
      .eq("id", userId)
      .single()

    if (fetchError || !user) {
      return NextResponse.json(
        { error: "Usuario no encontrado" },
        { status: 404 }
      )
    }

    // Un superadmin no se bloquea desde el panel (ni a sí mismo ni a otro):
    // la marca y el acceso de esas filas se manejan desde el SQL editor.
    if (user.es_superadmin) {
      return NextResponse.json(
        { error: "No se puede bloquear a un superadmin desde el panel" },
        { status: 403 }
      )
    }

    const bloqueadoAntes = !!user.acceso_bloqueado_at
    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update(
        activo
          ? { acceso_bloqueado_at: null, acceso_bloqueado_por: null }
          : { acceso_bloqueado_at: new Date().toISOString(), acceso_bloqueado_por: adminEmail }
      )
      .eq("id", userId)

    if (updateError) throw updateError

    // Sin refresh tokens no puede restaurar la sesión desde la PWA ni pasar la
    // próxima revalidación del JWT.
    if (!activo) await invalidateRefreshToken(userId)

    await supabaseAdmin.from("audit_logs").insert({
      organization_id: user.organization_id,
      user_id: userId,
      action: "UPDATE",
      entity: "users",
      entity_id: userId,
      changes: {
        field: "acceso_bloqueado_at",
        before: bloqueadoAntes ? "bloqueado" : "habilitado",
        after: activo ? "habilitado" : "bloqueado",
        superadmin_email: adminEmail,
        action_description: activo
          ? `Acceso de "${user.nombre}" (${user.email}) habilitado por superadmin`
          : `Acceso de "${user.nombre}" (${user.email}) bloqueado por superadmin`,
      },
    })

    return NextResponse.json({
      success: true,
      message: activo
        ? `Acceso de ${user.nombre} habilitado`
        : `Acceso de ${user.nombre} bloqueado; sus sesiones se cierran`,
    })
  } catch (error) {
    console.error("Error toggling user access:", error)
    return NextResponse.json(
      { error: "Error al cambiar el acceso del usuario" },
      { status: 500 }
    )
  }
}
