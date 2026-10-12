import { supabaseAdmin, STORAGE_BUCKETS } from "@/lib/supabase"
import { ANON_NAME, anonymizedEmail, isAnonymizedEmail } from "./state"
import { assertSafePrefix } from "./storage"

export type AnonymizeResult =
  | { ok: true; alreadyAnonymized: boolean }
  | { ok: false; error: string }

function must(label: string, res: { error: { message: string } | null } | null | undefined) {
  if (res?.error) throw new Error(`${label}: ${res.error.message}`)
}

// Avatar: {orgId}/{userId}.{ext}. El path se arma con ids de la DB (nunca con
// avatar_url, que puede ser una URL ajena) y ambos pasan por el guard de storage,
// así que nunca puede resultar un prefijo vacío ni la raíz del bucket. El filtro
// por `${userId}.` evita borrar el de otro usuario cuyo id empiece igual (list
// usa búsqueda por substring).
async function removeAvatarFiles(organizationId: string | null, userId: string) {
  if (!organizationId) return
  assertSafePrefix(organizationId)
  const bucket = supabaseAdmin.storage.from(STORAGE_BUCKETS.AVATARS)
  const { data, error } = await bucket.list(organizationId, { search: userId })
  if (error) {
    if (/not found/i.test(error.message)) return
    throw new Error(`avatar list: ${error.message}`)
  }
  const paths = (data ?? [])
    .filter((f) => f.name.startsWith(`${userId}.`))
    .map((f) => `${organizationId}/${f.name}`)
  if (paths.length === 0) return
  const { error: rmError } = await bucket.remove(paths)
  if (rmError) throw new Error(`avatar remove: ${rmError.message}`)
}

/**
 * Anonimiza a un usuario dado de baja hace más de 30 días. La fila NO se borra:
 * ventas, caja, órdenes y cuenta corriente la referencian con FK sin ON DELETE.
 * Las operaciones quedan firmadas como "Usuario eliminado".
 */
export async function anonymizeUser(userId: string): Promise<AnonymizeResult> {
  try {
    if (typeof userId !== "string" || !userId.trim()) throw new Error("userId inválido")
    assertSafePrefix(userId)
    if (userId.includes("/")) throw new Error("userId inválido")

    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("id, email, organization_id")
      .eq("id", userId)
      .maybeSingle()
    if (error) return { ok: false, error: error.message }
    if (!user || isAnonymizedEmail(user.email)) return { ok: true, alreadyAnonymized: true }

    await removeAvatarFiles(user.organization_id, userId)
    must("totp_used_codes", await supabaseAdmin.from("totp_used_codes").delete().eq("user_id", userId))
    must("push_tokens", await supabaseAdmin.from("push_tokens").delete().eq("user_id", userId))
    must("web_push_subscriptions", await supabaseAdmin.from("web_push_subscriptions").delete().eq("user_id", userId))
    must("audit_logs", await supabaseAdmin.from("audit_logs").update({ ip_address: null, user_agent: null }).eq("user_id", userId))

    // Último: es lo que marca "ya terminó" para la idempotencia.
    must(
      "users",
      await supabaseAdmin
        .from("users")
        .update({
          email: anonymizedEmail(userId),
          nombre: ANON_NAME,
          password: null,
          telefono: null,
          avatar_url: null,
          refresh_token: null,
          refresh_token_expires: null,
          reset_token: null,
          reset_token_expiry: null,
          email_verification_token: null,
          email_verification_expires: null,
          totp_enabled: false,
          totp_secret: null,
          totp_backup_codes: null,
          totp_verified_at: null,
          activo: false,
        })
        .eq("id", userId)
    )
    return { ok: true, alreadyAnonymized: false }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
