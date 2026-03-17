export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
export const GOOGLE_ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID
export const GOOGLE_ADS_CONVERSION_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_ID

/** Dispara un evento de conversión de Google Ads */
export function trackAdsConversion(conversionLabel?: string) {
  if (!window.gtag || !GOOGLE_ADS_ID) return

  window.gtag("event", "conversion", {
    send_to: conversionLabel
      ? `${GOOGLE_ADS_ID}/${conversionLabel}`
      : GOOGLE_ADS_CONVERSION_ID,
  })
}

/** Dispara un evento personalizado en GA4 */
export function trackEvent(eventName: string, params?: Record<string, unknown>) {
  if (!window.gtag) return
  window.gtag("event", eventName, params)
}
