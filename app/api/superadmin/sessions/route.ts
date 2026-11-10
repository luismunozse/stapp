import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { createSuperadminAuditLogger } from "@/lib/superadmin-audit"

/**
 * POST: Revocar todas las sesiones activas (excepto la del superadmin actual).
 * Invalida todos los refresh tokens de usuarios.
 */
export async function POST(request: Request) {
  try {
    const { error, email, userId } = await requireSuperadmin()
    if (error) return error

    // Invalidar todas las sesiones excepto las del superadmin actual: las de la
    // tabla refresh_tokens y los tokens previos a ella que quedan en users.
    const { data: sesiones, error: dbError } = await supabaseAdmin
      .from("refresh_tokens")
      .delete()
      .neq("user_id", userId)
      .select("id")

    if (dbError) throw dbError

    const { data: legados, error: legadoError } = await supabaseAdmin
      .from("users")
      .update({ refresh_token: null, refresh_token_expires: null })
      .not("id", "eq", userId)
      .not("refresh_token", "is", null)
      .select("id")

    if (legadoError) throw legadoError

    const revokedCount = (sesiones?.length ?? 0) + (legados?.length ?? 0)

    // Audit log
    const auditLogger = createSuperadminAuditLogger(email, request)
    auditLogger
      .log({
        userId,
        action: "BULK_ACTION",
        entity: "sessions",
        description: `Revocación masiva de sesiones: ${revokedCount} sesiones invalidadas`,
        metadata: { revokedCount },
      })
      .catch(() => {})

    return NextResponse.json({
      success: true,
      message: `${revokedCount} sesiones revocadas`,
      revokedCount,
    })
  } catch (err) {
    console.error("Error revoking sessions:", err)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
