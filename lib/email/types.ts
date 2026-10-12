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
