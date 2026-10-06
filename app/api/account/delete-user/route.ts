import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"
import { verifyReauth } from "@/lib/account-deletion/reauth"
import { notifyAdminsUserDeleted } from "@/lib/account-deletion/emails"

const bodySchema = z.object({
  password: z.string().max(200).optional(),
  email: z.string().max(200).optional(),
  totpCode: z.string().max(32).optional(),
})

// POST /api/account/delete-user: el usuario elimina SU PROPIO usuario.
// La fila no se borra (ventas, caja y órdenes la referencian): se marca
// deleted_at y a los 30 días el cron la anonimiza.
export async function POST(request: Request) {
  const { error, userId, organizationId, session } = await requireAuth()
  if (error) return error

  // El middleware ya bloquea escrituras en impersonación; esto es defensa en profundidad.
  // Los superadmin no tienen un taller propio que dar de baja desde acá.
  if (session!.user.isImpersonating || session!.user.isSuperadmin) {
    return NextResponse.json({ error: "Acción no permitida en esta sesión" }, { status: 403 })
  }

  const parsed = await safeParseBody(request, bodySchema)
  if ("error" in parsed) return parsed.error

  const reauth = await verifyReauth(userId!, parsed.data)
  if (!reauth.ok) {
    // Cuenta bloqueada por intentos fallidos: 429, el resto de fallos conserva su status.
    const status = reauth.code === "ACCOUNT_LOCKED" ? 429 : reauth.status
    return NextResponse.json({ error: reauth.error, code: reauth.code }, { status })
  }

  const { data: user } = await supabaseAdmin
    .from("users")
    .select("nombre, email, rol")
    .eq("id", userId!)
    .single()

  // Guarda del último ADMIN + deleted_at + activo=false + refresh_token=NULL en UNA transacción.
  const { data: estado, error: rpcError } = await supabaseAdmin.rpc("solicitar_baja_usuario", {
    p_user_id: userId!,
  })
  if (rpcError) {
    console.error("[account/delete-user] rpc:", rpcError)
    return NextResponse.json({ error: "No pudimos procesar la baja" }, { status: 500 })
  }

  if (estado === "NOT_FOUND") {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })
  }
  if (estado === "LAST_ADMIN") {
    return NextResponse.json(
      {
        error: "Sos el último administrador del taller. Eliminá el taller o pasale el rol de administrador a otro usuario.",
        code: "LAST_ADMIN",
      },
      { status: 409 }
    )
  }
  if (estado === "ALREADY_DELETED") {
    return NextResponse.json({ success: true })
  }

  // Tokens de notificaciones: best-effort, la baja ya está hecha y no se deshace.
  const limpiezas = await Promise.allSettled([
    supabaseAdmin.from("push_tokens").delete().eq("user_id", userId!),
    supabaseAdmin.from("web_push_subscriptions").delete().eq("user_id", userId!),
  ])
  const tablas = ["push_tokens", "web_push_subscriptions"]
  limpiezas.forEach((r, i) => {
    if (r.status === "rejected") {
      console.error(`[account/delete-user] limpieza de ${tablas[i]}:`, r.reason)
    } else if (r.value?.error) {
      console.error(`[account/delete-user] limpieza de ${tablas[i]}:`, r.value.error)
    }
  })

  try {
    const { error: auditError } = await supabaseAdmin.from("audit_logs").insert({
      organization_id: organizationId,
      user_id: userId,
      action: "DELETE",
      entity: "users",
      entity_id: userId,
      changes: { self_service: true },
    })
    if (auditError) console.error("[account/delete-user] audit_logs:", auditError)
  } catch (err) {
    console.error("[account/delete-user] audit_logs:", err)
  }

  await notifyAdminsUserDeleted({
    organizationId: organizationId!,
    userId: userId!,
    nombre: user?.nombre ?? "",
    email: user?.email ?? "",
    rol: user?.rol ?? "",
  })

  return NextResponse.json({ success: true })
}
