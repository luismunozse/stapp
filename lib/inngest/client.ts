import { Inngest } from "inngest"

// Crear cliente de Inngest
export const inngest = new Inngest({
  id: "stapp",
  name: "STApp - Servicio Técnico",
})

// Tipos de eventos
export type NotificationEvent = {
  name: "notification/send"
  data: {
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
  }
}

export type DailyReminderEvent = {
  name: "reminder/daily-check"
  data: Record<string, never>
}

// Unión de todos los eventos
export type InngestEvents = {
  "notification/send": NotificationEvent
  "reminder/daily-check": DailyReminderEvent
}
