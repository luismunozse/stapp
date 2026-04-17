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

interface CacheEntry {
  data: TenantStatus | null
  expiresAt: number
}

const store = new Map<string, CacheEntry>()
const TTL_MS = 30_000

export async function getTenantStatusBySlug(
  slug: string
): Promise<TenantStatus | null> {
  const now = Date.now()
  const hit = store.get(slug)
  if (hit && hit.expiresAt > now) {
    return hit.data
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) return null

  const url = `${base}/rest/v1/organizations?slug=eq.${encodeURIComponent(
    slug
  )}&select=id,activo&limit=1`

  try {
    const res = await fetch(url, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    })
    if (!res.ok) {
      // Fail-open: si Supabase falla, no bloqueamos el sitio entero.
      // Devolvemos null pero NO cacheamos para reintentar en el próximo request.
      return null
    }
    const rows = (await res.json()) as Array<TenantStatus>
    const data = rows[0] ?? null
    store.set(slug, { data, expiresAt: now + TTL_MS })
    return data
  } catch {
    return null
  }
}
