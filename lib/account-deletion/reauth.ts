import bcrypt from "bcryptjs"
import { supabaseAdmin } from "@/lib/supabase"
import { verifyUserTotpCode } from "@/lib/totp"
import type { ReauthInput } from "./types"

type ReauthCode = "WRONG_CREDENTIAL" | "REQUIRES_2FA" | "INVALID_2FA"

export type ReauthResult =
  | { ok: true }
  | { ok: false; status: 401; code: ReauthCode; error: string }

const fail = (code: ReauthCode, error: string): ReauthResult => ({
  ok: false,
  status: 401,
  code,
  error,
})

/**
 * Reautenticación antes de una acción destructiva. Contraseña para usuarios
 * `credentials`; email tipeado para usuarios Google (no tienen contraseña);
 * y TOTP/código de respaldo si tienen 2FA. Un fallo suma un intento al
 * lockout de la cuenta, igual que en el login: sin eso, una sesión robada
 * podría adivinar la contraseña acá sin límite.
 *
 * Falla cerrado: un usuario sin contraseña que tampoco es `google` nunca pasa.
 */
export async function verifyReauth(userId: string, input: ReauthInput): Promise<ReauthResult> {
  const { data: user, error } = await supabaseAdmin
    .from("users")
    .select("email, password, provider, totp_enabled")
    .eq("id", userId)
    .single()
  if (error || !user) return fail("WRONG_CREDENTIAL", "No pudimos verificar tu identidad")

  const penalize = () => {
    Promise.resolve(supabaseAdmin.rpc("handle_failed_login", { p_email: user.email })).catch(() => {})
  }

  const password = typeof input.password === "string" ? input.password : ""
  const typedEmail = typeof input.email === "string" ? input.email : ""

  let credentialOk = false
  if (user.password) {
    credentialOk = password.length > 0 && (await bcrypt.compare(password, user.password))
  } else if (user.provider === "google") {
    credentialOk = typedEmail.trim().toLowerCase() === String(user.email).trim().toLowerCase()
  }
  if (!credentialOk) {
    penalize()
    return fail("WRONG_CREDENTIAL", user.password ? "Contraseña incorrecta" : "El email no coincide con tu cuenta")
  }

  if (user.totp_enabled) {
    if (typeof input.totpCode !== "string" || !input.totpCode) {
      return fail("REQUIRES_2FA", "Ingresá tu código de verificación")
    }
    const totp = await verifyUserTotpCode(userId, input.totpCode)
    if (!totp.valid) {
      penalize()
      return fail("INVALID_2FA", "Código de verificación inválido")
    }
  }

  return { ok: true }
}
