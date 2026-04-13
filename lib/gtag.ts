export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
export const GOOGLE_ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID
export const GOOGLE_ADS_CONVERSION_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_ID

/** Dispara un evento de conversión de Google Ads.
 *  Devuelve una promesa que se resuelve cuando Google confirma la recepción
 *  o después de un timeout de seguridad (para no bloquear la UI). */
export function trackAdsConversion(conversionLabel?: string): Promise<void> {
  return new Promise((resolve) => {
    if (!window.gtag || !GOOGLE_ADS_ID) {
      resolve()
      return
    }

    // Timeout de seguridad: si Google no responde en 1.5s, seguimos igual
    const timeout = setTimeout(resolve, 1500)

    window.gtag("event", "conversion", {
      send_to: conversionLabel
        ? `${GOOGLE_ADS_ID}/${conversionLabel}`
        : GOOGLE_ADS_CONVERSION_ID,
      event_callback: () => {
        clearTimeout(timeout)
        resolve()
      },
    })
  })
}

/** Dispara un evento personalizado en GA4 */
export function trackEvent(eventName: string, params?: Record<string, unknown>) {
  if (!window.gtag) return
  window.gtag("event", eventName, params)
}
