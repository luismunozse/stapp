import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// GET /api/auth/2fa/status - Obtiene el estado de 2FA del usuario
export async function GET() {
  const { error, userId } = await requireAuth()
  if (error) return error

  const { data: user, error: userError } = await supabaseAdmin
    .from("users")
    .select("totp_enabled, totp_verified_at")
    .eq("id", userId)
    .single()

  if (userError || !user) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })
  }

  return NextResponse.json({
    totpEnabled: user.totp_enabled || false,
    verifiedAt: user.totp_verified_at,
  })
}
