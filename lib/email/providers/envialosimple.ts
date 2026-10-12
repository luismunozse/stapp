import { addressOf, type EmailProvider } from "../types"

const API_URL = "https://backend.envialosimple.email/api/v1/mail/send"

/**
 * Adaptador a EnvialoSimple. Es el `fetch` que vivia en lib/email.ts, movido
 * sin cambio de conducta salvo uno: EMAIL_FROM se lee en cada llamada y no al
 * cargar el modulo, para que sea testeable.
 */
export const envialoSimpleProvider: EmailProvider = {
  nombre: "envialosimple",

  async send({ to, subject, html, fromName, substitutions, attachments }) {
    const apiKey = process.env.ENVIALOSIMPLE_API_KEY
    if (!apiKey) {
      throw new Error("ENVIALOSIMPLE_API_KEY no esta configurada")
    }

    const base = process.env.EMAIL_FROM || "noreply@stapp.com.ar"
    const from = fromName ? `${fromName} <${addressOf(base)}>` : base

    const payload: Record<string, unknown> = { from, to, subject, html }

    if (substitutions) {
      payload.substitutions = substitutions
    }

    if (attachments && attachments.length > 0) {
      payload.attachments = attachments.map((att) => ({
        filename: att.filename,
        content: att.content,
        type: att.type,
        disposition: "attachment",
      }))
    }

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorData = await response.text()
      console.error("EnvialoSimple error:", errorData)
      console.error("EnvialoSimple status:", response.status)
      console.error("EnvialoSimple payload keys:", Object.keys(payload))
      if (attachments && attachments.length > 0) {
        console.error("EnvialoSimple attachment info:", attachments.map(a => ({ filename: a.filename, type: a.type, contentLength: a.content.length })))
      }
      throw new Error(`Error al enviar el correo: ${errorData}`)
    }

    const json = (await response.json()) as { id?: string } | null
    return { id: json?.id ?? null, proveedor: "envialosimple" }
  },
}
