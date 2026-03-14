/**
 * Google Analytics & Google Ads conversion tracking helpers.
 *
 * Uso:
 *   import { trackEvent, trackConversion } from "@/lib/analytics"
 *   trackEvent("sign_up", { method: "email" })
 *   trackConversion("AW-XXXXX/YYYYY") // Google Ads conversion label
 */

type GtagEvent = {
  action: string
  category?: string
  label?: string
  value?: number
  [key: string]: unknown
}

export function trackEvent(
  action: string,
  params?: Omit<GtagEvent, "action">
) {
  if (typeof window === "undefined" || !window.gtag) return
  window.gtag("event", action, params)
}

/**
 * Trackea una conversión de Google Ads.
 * @param conversionLabel - El label de conversión (ej: "AW-123456789/abcDEF")
 * @param value - Valor opcional de la conversión
 * @param currency - Moneda (default: ARS)
 */
export function trackConversion(
  conversionLabel: string,
  value?: number,
  currency = "ARS"
) {
  if (typeof window === "undefined" || !window.gtag) return
  window.gtag("event", "conversion", {
    send_to: conversionLabel,
    ...(value != null && { value, currency }),
  })
}

// ── Eventos predefinidos para STApp ──

export const analytics = {
  /** Usuario hizo click en "Comenzar Gratis" */
  clickCTA: (ctaName: string, location: string) =>
    trackEvent("cta_click", {
      cta_name: ctaName,
      cta_location: location,
    }),

  /** Usuario inició el registro */
  startRegistration: () =>
    trackEvent("sign_up_start"),

  /** Usuario completó el registro */
  completeRegistration: (method = "email") =>
    trackEvent("sign_up", { method }),

  /** Usuario envió formulario de contacto */
  submitContactForm: () =>
    trackEvent("generate_lead", {
      event_category: "contact",
      event_label: "contact_form",
    }),

  /** Lead capturado por chatbot */
  chatbotLead: () =>
    trackEvent("generate_lead", {
      event_category: "chatbot",
      event_label: "chatbot_lead",
    }),

  /** Usuario vio la sección de pricing */
  viewPricing: () =>
    trackEvent("view_item", {
      event_category: "pricing",
      items: [{ item_name: "STApp Pro", price: 19999, currency: "ARS" }],
    }),

  /** Usuario inició el checkout / suscripción */
  beginCheckout: (plan: "monthly" | "yearly") =>
    trackEvent("begin_checkout", {
      event_category: "subscription",
      event_label: plan,
    }),
}
