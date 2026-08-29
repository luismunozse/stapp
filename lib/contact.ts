/**
 * Single source of truth for STApp's public contact details.
 *
 * These values are published to customers in several places at once: the
 * contact page, the landing WhatsApp button, the careers page and the
 * Organization/LocalBusiness JSON-LD. Keeping a copy in each of them is what
 * let two wrong values ship at the same time — a phone number copied from a
 * form's `placeholder` attribute, and a support address on `stapp.com`, a
 * domain we do not own (its MX points at a registrar's parking host, so that
 * mail never reached us).
 *
 * Anything shown to the public goes through here.
 */

/** E.164, for `tel:` links, wa.me URLs and schema.org `telephone`. */
export const CONTACT_PHONE_E164 = "+5491169625733"

/** Same number without the `+`, which is the format wa.me expects. */
export const CONTACT_WHATSAPP_NUMBER = "5491169625733"

/** Human-readable form, for anything a person actually reads. */
export const CONTACT_PHONE_DISPLAY = "+54 9 11 6962-5733"

/**
 * The one real mailbox. Everything public points here, CVs from the careers
 * page included — there is no separate jobs@ inbox. Must stay on
 * stapp.com.ar; see the note above.
 */
export const CONTACT_EMAIL = "soporte@stapp.com.ar"

/** Builds a wa.me link with a prefilled message. */
export function whatsAppUrl(message: string): string {
  return `https://wa.me/${CONTACT_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`
}
