/**
 * Lightweight GA4/Google Ads event tracker.
 *
 * Uso:
 *   import { track } from "@/lib/analytics/track"
 *   track("landing_cta_click", { cta: "hero_primary" })
 *
 * - NO-op en SSR (server components / build time).
 * - NO-op si gtag no está cargado (ej. consent denegado o IDs no configurados).
 * - Nunca lanza excepciones: si algo falla, falla silencioso (analytics nunca debe
 *   romper la UI).
 *
 * Eventos clave del funnel marketing (ver tareas de tracking del proyecto):
 *   - landing_cta_click   → click en CTAs principales de la landing
 *   - pricing_page_view   → mount de /precios
 *   - whatsapp_clicked    → click en el botón flotante de WhatsApp
 *   - signup_started      → inicio del flujo de registro (en /registro)
 *   - trial_started       → confirmación de cuenta creada
 *   - upgrade_clicked     → apertura del modal de upgrade
 *   - payment_initiated   → click en "Continuar al pago"
 */
export function track(event: string, params?: Record<string, any>): void {
  if (typeof window === "undefined") return
  const gtag = (window as typeof window & { gtag?: (...args: any[]) => void }).gtag
  if (typeof gtag !== "function") return
  try {
    gtag("event", event, params)
  } catch {
    // Silencio absoluto: analytics nunca debe romper el render.
  }
}
