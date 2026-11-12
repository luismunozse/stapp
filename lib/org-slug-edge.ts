// Slug de una organización por id, seguro para Edge runtime (proxy).
// Mismo patrón que lib/tenant-status-edge.ts: fetch directo al REST de
// Supabase con el service role key, sin @/lib/supabase.
//
// Lo usa el proxy para mandar al usuario logueado de la landing (stapp.com.ar/
// y /precios) a su panel (<slug>.stapp.com.ar/dashboard) sin que la página
// tenga que llamar a auth() ni a Supabase en cada request.
//
// Cache en memoria por instancia: el slug de una org casi nunca cambia, y si
// cambia el peor caso es un redirect a un subdominio viejo durante el TTL.

export type OrgSlugLookup = { kind: "ok"; slug: string | null } | { kind: "error" }

interface CacheEntry {
  slug: string | null
  expiresAt: number
}

const store = new Map<string, CacheEntry>()
const TTL_MS = 5 * 60_000

export async function getOrgSlugById(organizationId: string): Promise<OrgSlugLookup> {
  const now = Date.now()
  const hit = store.get(organizationId)
  if (hit && hit.expiresAt > now) return { kind: "ok", slug: hit.slug }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) return { kind: "error" }

  const url = `${base}/rest/v1/organizations?id=eq.${encodeURIComponent(
    organizationId
  )}&select=slug,activo,deleted_at&limit=1`

  try {
    const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
    if (!res.ok) return { kind: "error" }
    const rows = (await res.json()) as Array<{ slug: string | null; activo: boolean; deleted_at: string | null }>
    const row = rows[0]
    // Org borrada o desactivada: no redirigimos (el subdominio mandaría a
    // /tenant-not-found); se muestra la landing como hasta ahora.
    const slug = row && !row.deleted_at && row.activo && row.slug ? row.slug : null
    store.set(organizationId, { slug, expiresAt: now + TTL_MS })
    return { kind: "ok", slug }
  } catch {
    return { kind: "error" }
  }
}
