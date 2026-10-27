import { supabaseAdmin } from "@/lib/supabase"

interface SesionConUsuario {
  user: { id: string; role?: string | null; organizationId: string; sucursalId?: string | null }
}

interface FilaUsuario {
  rol: string | null
  sucursal_id: string | null
  organization_id: string | null
  deleted_at: string | null
}

// Per-instance cache of the users row, same idea as lib/user-status-edge.ts
// (30 s there). The row, not the verdict, is cached: role and org are compared
// against the CURRENT session on every call.
//
// Freshness trade-off: a move, a role change or a deletion takes effect on the
// affected user's next request after the entry expires, i.e. within ~5 s on every
// instance (each one holds its own entry, none outlives the TTL). That is the
// price of not adding a users query to every request of every user; it is still
// ~18 h better than waiting for the JWT to be re-signed.
//
// Failures and missing rows are never cached. Concurrent misses of one user share
// a single in-flight query (single-flight), and that entry is dropped as soon as
// the query settles, so a rejection is never remembered either.
const TTL_MS = 5_000
export const CACHE_MAX_ENTRIES = 5000
// A hung query must not hang every request of the user (they all wait on the
// same single-flight promise): past this it is aborted and the request fails
// closed with a 500, and the in-flight entry is dropped so the next one retries.
const LOOKUP_TIMEOUT_MS = 3_000
const cache = new Map<string, { fila: FilaUsuario; expiresAt: number }>()
const enVuelo = new Map<string, Promise<FilaUsuario | null>>()

export function clearSesionSucursalCache(): void {
  cache.clear()
  enVuelo.clear()
}

async function consultar(userId: string): Promise<FilaUsuario | null> {
  const inicio = Date.now()
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("rol, sucursal_id, organization_id, deleted_at")
    .eq("id", userId)
    .abortSignal(AbortSignal.timeout(LOOKUP_TIMEOUT_MS))
    .maybeSingle()

  if (error) throw new Error(`Could not read the user's row: ${error.message}`)
  if (!data) return null

  const fila = data as FilaUsuario
  // A full cache is emptied when a NEW user arrives. Refreshing a user that is
  // already in it replaces its own entry and evicts nobody else.
  if (cache.size >= CACHE_MAX_ENTRIES && !cache.has(userId)) cache.clear()
  cache.set(userId, { fila, expiresAt: inicio + TTL_MS })
  return fila
}

function leerFila(userId: string): Promise<FilaUsuario | null> {
  const hit = cache.get(userId)
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.fila)

  const pendiente = enVuelo.get(userId)
  if (pendiente) return pendiente

  // Only drop our own entry: clearSesionSucursalCache() may have let a newer
  // flight of this user start while this one was still pending.
  const consulta: Promise<FilaUsuario | null> = consultar(userId).finally(() => {
    if (enVuelo.get(userId) === consulta) enVuelo.delete(userId)
  })
  enVuelo.set(userId, consulta)
  return consulta
}

/**
 * Checks that the session still describes the user in the DB and, for a
 * TECNICO/VENDEDOR, replaces `user.sucursalId` with what `users.sucursal_id`
 * holds right now, so an ADMIN moving a technician or seller to another branch
 * governs that user's next requests instead of whenever the JWT is re-signed
 * (up to ~18 h later; see the cache note above for the ~5 s of lag that remains).
 *
 * - One primary-key lookup (cached ~5 s) reads role, organization, deletion mark
 *   and branch, because the JWT is just as stale for all of them.
 * - ADMIN is verified the same way (a demoted ADMIN must not keep ADMIN powers
 *   until the JWT is re-signed) but its session is returned untouched: an ADMIN
 *   has no branch (CHECK from migration 241) and picks one through the cookie.
 * - For everyone else the result is a copy; the object `auth()` produced is never
 *   mutated.
 * - Returns null when the JWT no longer describes the user: the row is gone,
 *   `deleted_at` is set, the DB role differs from the JWT role, or the DB
 *   organization differs from the JWT organization. requireAuth() turns that
 *   into a 401 `SESSION_STALE` and clears the session cookie, so the next
 *   navigation reaches /login instead of looping on a 401 (the middleware sees
 *   no token and redirects).
 *
 * THROWS when the lookup fails, and callers must let that become a 500. This is
 * deliberately fail-closed and never falls back to the JWT value, nor to an
 * expired cache entry:
 *   - the JWT branch (or role) may be exactly what an ADMIN just took away, so
 *     trusting it on a failed read would hand back access that was revoked;
 *   - treating the failure as "no branch" would turn into SUCURSAL_NINGUNA and
 *     show every screen empty, which looks like lost data and gets nobody to retry.
 * A visible, retryable error is the honest answer (same stance as
 * `depositoPermitido`).
 */
export async function conSucursalVigente<S extends SesionConUsuario>(session: S): Promise<S | null> {
  const fila = await leerFila(session.user.id)
  if (
    !fila ||
    fila.deleted_at ||
    fila.rol !== session.user.role ||
    fila.organization_id !== session.user.organizationId
  ) {
    return null
  }

  if (session.user.role === "ADMIN") return session
  return { ...session, user: { ...session.user, sucursalId: fila.sucursal_id ?? null } }
}
