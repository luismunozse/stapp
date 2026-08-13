/**
 * Detects Postgres/PostgREST "unknown column" errors so callers can retry a
 * query without a column that a not-yet-applied migration hasn't created.
 *
 * The two error shapes are NOT interchangeable and both need to be checked:
 *   - WRITE payloads (insert/update naming an unknown column): PostgREST
 *     validates the JSON body against its schema cache BEFORE building any
 *     SQL, and returns PGRST204 ("Could not find the 'x' column of 'y' in
 *     the schema cache").
 *   - SELECT lists (a `select=`/`.select()` referencing an unknown column,
 *     including PostgREST's `.update().select()` RETURNING clause when the
 *     write payload itself doesn't reference that column): PostgREST passes
 *     the query through to Postgres, which raises its own undefined_column
 *     error, 42703 ("column table.x does not exist") — NOT PGRST204.
 * A guard that only checks PGRST204 is dead code for every SELECT-side
 * missing-column retry: it never fires, so the request either 404s (falsy
 * `.single()` data) or 500s after a write already committed. See
 * app/api/configuracion/route.ts and app/api/facturacion/[id]/pdf/route.ts
 * for the routes this protects (migration 295's fiscal identity columns).
 */
export function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const e = error as Record<string, unknown>
  const code = String(e.code ?? "")
  const msg = String(e.message ?? "").toLowerCase()
  return (
    code === "PGRST204" ||
    code === "42703" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  )
}
