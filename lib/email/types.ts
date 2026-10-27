/** Contratos del envio de correo. Sin logica: sólo la forma de los datos. */

export interface EmailAttachment {
  filename: string
  /** Contenido en base64. */
  content: string
  /** MIME type, ej. "application/pdf". */
  type: string
}

export interface EmailMessage {
  to: string
  subject: string
  html: string
  /**
   * Nombre visible del remitente (ej. el nombre del taller). La direccion
   * siempre es la verificada del proveedor, nunca la del taller.
   */
  fromName?: string
  /**
   * Direccion propia del taller a la que le llegan las respuestas del cliente.
   * El `from` sigue siendo la direccion verificada del proveedor.
   */
  replyTo?: string
  /** Sustituciones del lado del proveedor. Sólo EnvialoSimple las soporta. */
  substitutions?: Record<string, string>
  attachments?: EmailAttachment[]
}

export type NombreProveedor = "envialosimple" | "resend"

export interface SendResult {
  /** Id que asigna el proveedor. Es la clave de correlacion con el webhook. */
  id: string | null
  proveedor: NombreProveedor
}

export interface EmailProvider {
  readonly nombre: NombreProveedor
  send(msg: EmailMessage): Promise<SendResult>
}

/** Extrae la direccion de un from con formato "Nombre <addr>" o "addr". */
export function addressOf(from: string): string {
  const match = from.match(/<([^>]+)>/)
  return match ? match[1].trim() : from.trim()
}

/**
 * Arma el header `From` con un nombre visible que es TEXTO LIBRE del taller.
 * Se sanea porque termina en un header: CR/LF permitiria inyectar headers, y
 * comillas, comas o "<>" sin escapar producen un From invalido (Resend 422).
 * Un nombre sin caracteres especiales queda sin comillas, igual que siempre.
 */
export function formatFrom(fromName: string | undefined, base: string): string {
  const nombre = (fromName ?? "")
    // eslint-disable-next-line no-control-regex -- se eliminan caracteres de control a proposito
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/[<>"\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!nombre) return base

  const visible = /[()[\]:;@,.]/.test(nombre) ? `"${nombre}"` : nombre
  return `${visible} <${addressOf(base)}>`
}
