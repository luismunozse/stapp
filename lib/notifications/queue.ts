import { sendNotificationDirect } from "./send-direct"

/**
 * Encolar / enviar una notificación.
 *
 * Actualmente ejecuta directamente vía `sendNotificationDirect` (fire-and-forget
 * desde las API routes). Se mantiene esta función como punto de entrada único
 * por si en el futuro se reintroduce una cola asíncrona.
 */
export async function queueNotification(params: {
  organizationId: string
  ordenId?: string
  garantiaId?: string
  clienteId: string
  tipo: "CAMBIO_ESTADO" | "PRESUPUESTO_DEFINIDO" | "GARANTIA_CREADA" | "RECORDATORIO_RETIRO"
  context: {
    organizationName: string
    moneda?: string
    zonaHoraria?: string
    cliente: {
      id: string
      nombre: string
      email?: string | null
      telefono: string
    }
    orden?: {
      id: string
      numeroOrden: number
      dispositivo: string
      estado: string
      estadoAnterior?: string
      presupuesto?: number | null
      fechaCompletado?: string | null
    }
    garantia?: {
      id: string
      diasValidez: number
      fechaVencimiento: string
    }
  }
}) {
  return sendNotificationDirect(params)
}
