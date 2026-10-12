// Estado de baja de un usuario, seguro para Edge runtime (middleware).
// Hace fetch directo al REST de Supabase con el service role key, con caché en
// memoria de 30 s. El JWT de un usuario dado de baja sigue siendo válido hasta
// ~18 h (solo se revalida contra la BD en las últimas 6 h de su día de vida),
// así que esto es lo que corta la sesión viva.

export type UserStatusLookup = { kind: "ok"; deleted: boolean } | { kind: "error" }

const store = new Map<string, { deleted: boolean; expiresAt: number }>()
const TTL_MS = 30_000
const MAX_ENTRIES = 5000

export function clearUserStatusCache(): void {
  store.clear()
}

export async function getUserDeletedStatus(userId: string): Promise<UserStatusLookup> {
  const now = Date.now()
  const hit = store.get(userId)
  if (hit) {
    if (hit.expiresAt > now) return { kind: "ok", deleted: hit.deleted }
    store.delete(userId)
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) return { kind: "error" }

  const url = `${base}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=deleted_at&limit=1`
  try {
    const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
    if (!res.ok) return { kind: "error" } // no se cachea: reintenta en el próximo request
    const rows = (await res.json()) as Array<{ deleted_at: string | null }>
    // Fila inexistente = no se puede afirmar que fue dado de baja: no se corta la sesión.
    const deleted = !!rows[0]?.deleted_at
    if (store.size >= MAX_ENTRIES) store.clear()
    store.set(userId, { deleted, expiresAt: now + TTL_MS })
    return { kind: "ok", deleted }
  } catch {
    return { kind: "error" }
  }
}
