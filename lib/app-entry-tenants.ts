/**
 * Negocio recordado por la app nativa. /app-entry (dominio raíz) lo lee al
 * abrir la app y redirige directo a su login; también guarda los últimos 5
 * como "recientes". Vive en el localStorage del dominio raíz.
 *
 * El literal "stapp-tenant-slug" también aparece en login, navbar y
 * cerrar-sesion-tras-baja (lo borran al cambiar de negocio o cerrar sesión).
 */
export const TENANT_STORAGE_KEY = "stapp-tenant-slug"
export const RECENT_TENANTS_KEY = "stapp-recent-tenants"
const MAX_RECIENTES = 5

export function rememberTenant(slug: string): void {
  try {
    localStorage.setItem(TENANT_STORAGE_KEY, slug)
    const recent = JSON.parse(localStorage.getItem(RECENT_TENANTS_KEY) || "[]") as string[]
    const updated = [slug, ...recent.filter((s) => s !== slug)].slice(0, MAX_RECIENTES)
    localStorage.setItem(RECENT_TENANTS_KEY, JSON.stringify(updated))
  } catch {
    // Storage bloqueado o JSON corrupto: la app vuelve a pedir el negocio, nada más
  }
}
