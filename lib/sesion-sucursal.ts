import { supabaseAdmin } from "@/lib/supabase"

interface SesionConUsuario {
  user: { id: string; role?: string | null; sucursalId?: string | null }
}

/**
 * Returns `session` with `user.sucursalId` replaced by what `users.sucursal_id`
 * holds right now, so an ADMIN moving a technician or seller to another branch
 * governs that user's very next request instead of whenever the JWT is re-signed
 * (up to ~18 h later).
 *
 * - ADMIN: returned as is, no query. An ADMIN has no branch (CHECK from
 *   migration 241) and picks one through the cookie, so there is nothing to refresh.
 * - Everyone else: one primary-key lookup, never cached. A cache would bring back
 *   the staleness this exists to remove.
 * - Returns a copy; the object `auth()` produced is never mutated.
 * - Returns null when the user's row no longer exists (deleted account).
 *
 * THROWS when the lookup fails, and callers must let that become a 500. This is
 * deliberately fail-closed and never falls back to the JWT value:
 *   - the JWT branch may be exactly the one an ADMIN just took the user out of,
 *     so trusting it on a failed read would hand back access that was revoked;
 *   - treating the failure as "no branch" would turn into SUCURSAL_NINGUNA and
 *     show every screen empty, which looks like lost data and gets nobody to retry.
 * A visible, retryable error is the honest answer (same stance as
 * `depositoPermitido`).
 */
export async function conSucursalVigente<S extends SesionConUsuario>(session: S): Promise<S | null> {
  if (session.user.role === "ADMIN") return session

  const { data, error } = await supabaseAdmin
    .from("users")
    .select("sucursal_id")
    .eq("id", session.user.id)
    .maybeSingle()

  if (error) throw new Error(`Could not read users.sucursal_id: ${error.message}`)
  if (!data) return null

  return { ...session, user: { ...session.user, sucursalId: data.sucursal_id ?? null } }
}
