import { inngest } from "../client"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Cron job semanal para limpiar notificaciones viejas (>90 dias)
 * Se ejecuta los domingos a las 3:00 AM UTC
 */
export const cleanupNotifications = inngest.createFunction(
  {
    id: "cleanup-old-notifications",
    name: "Cleanup Old Notifications",
  },
  { cron: "0 3 * * 0" },
  async ({ step }) => {
    const result = await step.run("delete-old-notifications", async () => {
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - 90)

      // Eliminar notificaciones leidas de mas de 90 dias
      const { data: readData } = await supabaseAdmin
        .from("user_notifications")
        .delete()
        .lt("created_at", cutoffDate.toISOString())
        .not("read_at", "is", null)
        .select("id")

      // Eliminar notificaciones no leidas de mas de 180 dias
      const cutoff180 = new Date()
      cutoff180.setDate(cutoff180.getDate() - 180)

      const { data: unreadData } = await supabaseAdmin
        .from("user_notifications")
        .delete()
        .lt("created_at", cutoff180.toISOString())
        .is("read_at", null)
        .select("id")

      return {
        deletedRead: readData?.length || 0,
        deletedUnread: unreadData?.length || 0,
      }
    })

    return {
      success: true,
      ...result,
    }
  }
)
