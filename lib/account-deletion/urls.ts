// Validación de slug compartida con app/app-entry/page.tsx (que la importa de acá).
const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

export function isValidTenantSlug(raw: string): boolean {
  return SLUG_PATTERN.test(raw.trim().toLowerCase())
}

// El callbackUrl lo respeta el login desde la tarea 21; `#eliminar` abre la
// pestaña de seguridad de /perfil y hace scroll a la Zona de peligro.
export function buildDeletionLoginUrl(slug: string, rootDomain: string): string {
  return `https://${slug}.${rootDomain}/login?callbackUrl=${encodeURIComponent("/perfil#eliminar")}`
}
