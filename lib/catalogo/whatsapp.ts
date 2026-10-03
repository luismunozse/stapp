/**
 * WhatsApp del taller en el catálogo público.
 *
 * `catalogo_config.whatsapp` se guardó siempre crudo ("11 1234-5678"), y un
 * `wa.me/1112345678` sin código de país apunta a un número inexistente sin
 * ningún error visible. Todo link `wa.me` del catálogo sale de acá: se
 * normaliza con el país de la organización (mismo criterio que el resto de los
 * envíos de WhatsApp) y, si no puede ser un número entregable, no hay link.
 *
 * El país es obligatorio a propósito (ver #337): sin default nacional.
 */
import { formatPhoneForCountry } from "@/lib/countries"
import { validarDestinoWhatsApp } from "@/lib/whatsapp/destino"

/** Dígitos con código de país, o null si el número no es entregable. */
export function normalizarWhatsAppCatalogo(
  raw: string | null | undefined,
  pais: string | null | undefined
): string | null {
  if (!raw || !validarDestinoWhatsApp(raw, pais).valido) return null
  return formatPhoneForCountry(raw, pais)
}

/** Link `wa.me` a partir de un número ya normalizado. Null si no hay número. */
export function catalogoWhatsAppUrl(numero: string | null | undefined, texto?: string): string | null {
  const digitos = (numero ?? "").replace(/\D/g, "")
  if (!digitos) return null
  return `https://wa.me/${digitos}${texto ? `?text=${encodeURIComponent(texto)}` : ""}`
}
