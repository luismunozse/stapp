// Estado de baja de un usuario, seguro para Edge runtime (middleware).
// Hace fetch directo al REST de Supabase con el service role key, con caché en
// memoria de 30 s. El JWT de un usuario dado de baja sigue siendo válido hasta
// ~18 h (solo se revalida contra la BD en las últimas 6 h de su día de vida),
// así que esto es lo que corta la sesión viva.

// Además de la baja trae el bloqueo de acceso del panel y la marca de
// superadmin (394): las dos tienen que cortar o negar el acceso enseguida, no
// en la próxima revalidación del JWT (hasta 1 h).
export type UserStatus = { deleted: boolean; bloqueado: boolean; esSuperadmin: boolean }
export type UserStatusLookup = ({ kind: "ok" } & UserStatus) | { kind: "error" }

const store = new Map<string, UserStatus & { expiresAt: number }>()
const TTL_MS = 30_000
const MAX_ENTRIES = 5000

export function clearUserStatusCache(): void {
  store.clear()
}

export async function getUserDeletedStatus(userId: string): Promise<UserStatusLookup> {
  const now = Date.now()
  const hit = store.get(userId)
  if (hit) {
    if (hit.expiresAt > now) {
      return { kind: "ok", deleted: hit.deleted, bloqueado: hit.bloqueado, esSuperadmin: hit.esSuperadmin }
    }
    store.delete(userId)
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) return { kind: "error" }

  const url = `${base}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=deleted_at,acceso_bloqueado_at,es_superadmin&limit=1`
  try {
    const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
    if (!res.ok) return { kind: "error" } // no se cachea: reintenta en el próximo request
    const rows = (await res.json()) as Array<{
      deleted_at: string | null
      acceso_bloqueado_at?: string | null
      es_superadmin?: boolean | null
    }>
    // Fila inexistente = no se puede afirmar que fue dado de baja: no se corta la sesión.
    // Pero tampoco es superadmin: esa marca solo cuenta si la fila la tiene.
    const status: UserStatus = {
      deleted: !!rows[0]?.deleted_at,
      bloqueado: !!rows[0]?.acceso_bloqueado_at,
      esSuperadmin: rows[0]?.es_superadmin === true,
    }
    if (store.size >= MAX_ENTRIES) store.clear()
    store.set(userId, { ...status, expiresAt: now + TTL_MS })
    return { kind: "ok", ...status }
  } catch {
    return { kind: "error" }
  }
}
