/**
 * UTM parameter capture & persistence.
 *
 * Captura UTMs de la URL al llegar a la landing y los guarda en
 * sessionStorage para enviarlos al registrarse.
 */

const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const

export type UtmParams = Partial<Record<(typeof UTM_KEYS)[number], string>>

const STORAGE_KEY = "stapp_utm"

/** Leer UTMs de la URL actual y guardarlos en sessionStorage (si hay alguno). */
export function captureUtmParams(): void {
  if (typeof window === "undefined") return

  const params = new URLSearchParams(window.location.search)
  const utm: UtmParams = {}
  let found = false

  for (const key of UTM_KEYS) {
    const value = params.get(key)
    if (value) {
      utm[key] = value
      found = true
    }
  }

  // Solo sobrescribir si la URL actual tiene UTMs
  if (found) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(utm))
  }
}

/** Recuperar los UTMs guardados (o null si no hay). */
export function getStoredUtmParams(): UtmParams | null {
  if (typeof window === "undefined") return null

  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as UtmParams) : null
  } catch {
    return null
  }
}
