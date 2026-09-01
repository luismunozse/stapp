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

/**
 * Correo dirigido al CLIENTE FINAL del taller: cambios de estado de orden,
 * presupuesto, recordatorio de retiro, garantia, cobranza.
 *
 * Sale por un proveedor y un subdominio distintos a proposito. Si esta rama
 * se llenara de correo de plataforma, un pico de rebotes en el canal operativo
 * volveria a tumbar la verificacion de cuenta y el reset de contrasena, que es
 * exactamente lo que esta separacion evita.
 */
export async function sendCustomer(msg: EmailMessage): Promise<SendResult> {
  return envialoSimpleProvider.send(msg)
}
