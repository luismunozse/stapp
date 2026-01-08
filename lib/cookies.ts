/**
 * Utilidades para gestionar el consentimiento de cookies
 */

export type CookieConsentType = "all" | "essential" | "rejected" | null

/**
 * Obtiene el consentimiento de cookies actual
 */
export function getCookieConsent(): CookieConsentType {
  if (typeof window === "undefined") return null

  const consent = localStorage.getItem("cookie-consent")
  return consent as CookieConsentType
}

/**
 * Establece el consentimiento de cookies
 */
export function setCookieConsent(consent: CookieConsentType) {
  if (typeof window === "undefined") return

  if (consent === null) {
    localStorage.removeItem("cookie-consent")
  } else {
    localStorage.setItem("cookie-consent", consent)
  }
}

/**
 * Verifica si se permite usar cookies de analytics
 */
export function canUseAnalytics(): boolean {
  const consent = getCookieConsent()
  return consent === "all"
}

/**
 * Verifica si se permite usar cookies de marketing
 */
export function canUseMarketing(): boolean {
  const consent = getCookieConsent()
  return consent === "all"
}

/**
 * Verifica si el usuario ha dado algún consentimiento
 */
export function hasGivenConsent(): boolean {
  const consent = getCookieConsent()
  return consent !== null
}

/**
 * Resetea el consentimiento (útil para testing o configuración)
 */
export function resetCookieConsent() {
  setCookieConsent(null)
}
