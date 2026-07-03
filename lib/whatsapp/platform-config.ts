/**
 * Configuración de plataforma del servidor Evolution compartido.
 * baseUrl + apiKey son infra de plataforma (env), NO por organización.
 * Cada org conserva solo su instanceName (ver buildInstanceName).
 */

export interface PlatformEvolutionConfig {
  baseUrl: string
  apiKey: string
}

export function getPlatformEvolutionConfig(): PlatformEvolutionConfig | null {
  const baseUrl = process.env.EVOLUTION_BASE_URL?.trim().replace(/\/+$/, "")
  const apiKey = process.env.EVOLUTION_API_KEY?.trim()
  if (!baseUrl || !apiKey) return null
  return { baseUrl, apiKey }
}

/**
 * Nombre de instancia estable y único por organización. No editable por el tenant.
 */
export function buildInstanceName(organizationId: string): string {
  return `stapp-org-${organizationId}`
}

/**
 * Nombre de instancia estable y único por sucursal. No editable por el tenant.
 */
export function buildSucursalInstanceName(organizationId: string, sucursalId: string): string {
  return `stapp-org-${organizationId}-suc-${sucursalId}`
}
