// Re-exportar cliente
export { inngest } from "./client"
export type { NotificationEvent, DailyReminderEvent, InngestEvents } from "./client"

// Importar funciones
import { sendNotification } from "./functions/send-notification"
import { dailyReminders, checkExpiringWarranties } from "./functions/daily-reminders"
import { cleanupNotifications } from "./functions/cleanup-notifications"
import { lifecycleEmails, calculateEngagement } from "./functions/lifecycle-emails"
import { calculateFeatureUsage } from "./functions/feature-usage"
import { trialManagement } from "./functions/trial-management"

// Exportar array de funciones para el handler
export const functions = [
  sendNotification,
  dailyReminders,
  checkExpiringWarranties,
  cleanupNotifications,
  lifecycleEmails,
  calculateEngagement,
  calculateFeatureUsage,
  trialManagement,
]

// Helper para enviar notificación (ejecución directa, sin Inngest)
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
      esRetiroSinReparacion?: boolean
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
  const { sendNotificationDirect } = await import("@/lib/notifications/send-direct")
  return sendNotificationDirect(params)
}
