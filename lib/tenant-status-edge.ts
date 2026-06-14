// Chequeo de estado del tenant seguro para Edge runtime (middleware).
// No usa @/lib/supabase ni next/headers para evitar pulls de react/cache.
// Hace fetch directo al REST de Supabase con el service role key.
//
// Cache en memoria con TTL corto: amortiza latencia entre requests a la
// misma Edge instance sin bloquear más de 30s el efecto de una activación
// o desactivación hecha desde el panel superadmin.

export interface TenantStatus {
  id: string
  activo: boolean
}

// Resultado explícito para que el caller pueda distinguir:
//  - kind: "ok"    → Supabase respondió. status puede ser null (no existe) o la fila.
//  - kind: "error" → no pudimos consultar (env faltante, fetch throw, !ok).
//                    El middleware debe tratar esto como fail-open, no como "no existe".
export type TenantLookupResult =
  | { kind: "ok"; status: TenantStatus | null }
  | { kind: "error" }

interface CacheEntry {
  data: TenantStatus | null
  expiresAt: number
}

const store = new Map<string, CacheEntry>()
const TTL_MS = 30_000

export async function getTenantStatusBySlug(
  slug: string
): Promise<TenantLookupResult> {
  const now = Date.now()
  const hit = store.get(slug)
  if (hit && hit.expiresAt > now) {
    return { kind: "ok", status: hit.data }
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) return { kind: "error" }

  const url = `${base}/rest/v1/organizations?slug=eq.${encodeURIComponent(
    slug
  )}&select=id,activo,deleted_at&limit=1`

  try {
    const res = await fetch(url, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    })
    if (!res.ok) {
      // No cacheamos el error: queremos reintentar en el próximo request.
      return { kind: "error" }
    }
    const rows = (await res.json()) as Array<TenantStatus & { deleted_at: string | null }>
    const row = rows[0]
    const data: TenantStatus | null =
      row && !row.deleted_at ? { id: row.id, activo: row.activo } : null
    store.set(slug, { data, expiresAt: now + TTL_MS })
    return { kind: "ok", status: data }
  } catch {
    return { kind: "error" }
  }
}
