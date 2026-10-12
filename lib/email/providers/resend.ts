import { addressOf, type EmailProvider } from "../types"

const API_URL = "https://api.resend.com/emails"

/**
 * Adaptador a Resend. Cursa SOLO el correo dirigido al cliente final del
 * taller, sobre el subdominio avisos.stapp.com.ar.
 */
export const resendProvider: EmailProvider = {
  nombre: "resend",

  async send({ to, subject, html, fromName, substitutions, attachments }) {
    // Resend no tiene sustituciones del lado del proveedor, y este canal no
    // manda adjuntos. Se rompe fuerte en vez de descartarlos en silencio: un
    // drop mudo convierte un error de ruteo en un correo mutilado que nadie
    // mira.
    if (substitutions) {
      throw new Error("resendProvider: substitutions no esta soportado en el canal de cliente")
    }
    if (attachments && attachments.length > 0) {
      throw new Error("resendProvider: attachments no esta soportado en el canal de cliente")
    }

    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      throw new Error("RESEND_API_KEY no esta configurada")
    }

    const base = process.env.RESEND_FROM || "avisos@avisos.stapp.com.ar"
    const from = fromName ? `${fromName} <${addressOf(base)}>` : base

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    })

    if (!response.ok) {
      const errorData = await response.text()
      console.error("Resend error:", errorData)
      console.error("Resend status:", response.status)
      throw new Error(`Error al enviar el correo: ${errorData}`)
    }

    const json = (await response.json()) as { id?: string } | null
    return { id: json?.id ?? null, proveedor: "resend" }
  },
}
