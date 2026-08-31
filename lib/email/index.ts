import { envialoSimpleProvider } from "./providers/envialosimple"
import type { EmailMessage, SendResult } from "./types"

export type { EmailMessage, EmailAttachment, SendResult, EmailProvider } from "./types"

/**
 * Correo de plataforma: verificacion de cuenta, reset de contrasena,
 * facturacion, leads, soporte, cotizaciones y los crons de lifecycle.
 * Sale por el dominio principal.
 */
export async function sendPlatform(msg: EmailMessage): Promise<SendResult> {
  return envialoSimpleProvider.send(msg)
}
