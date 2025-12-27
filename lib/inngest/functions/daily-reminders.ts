import { inngest } from "../client"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Función cron que se ejecuta diariamente para enviar recordatorios
 * de retiro de dispositivos completados
 */
export const dailyReminders = inngest.createFunction(
  {
    id: "daily-reminders",
    name: "Daily Pickup Reminders",
  },
  { cron: "0 10 * * *" }, // Todos los días a las 10:00 AM
  async ({ step }) => {
    // Paso 1: Obtener organizaciones activas
    const organizations = await step.run("get-organizations", async () => {
      const { data } = await supabaseAdmin
        .from("organizations")
        .select("id, nombre, dias_recordatorio, notificaciones_email, notificaciones_whatsapp")
        .eq("activo", true)

      return data || []
    })

    const results: Array<{ orgId: string; sentCount: number }> = []

    // Paso 2: Procesar cada organización
    for (const org of organizations) {
      const sentCount = await step.run(`process-org-${org.id}`, async () => {
        // Si no tiene notificaciones habilitadas, skip
        if (!org.notificaciones_email && !org.notificaciones_whatsapp) {
          return 0
        }

        // Calcular fecha límite
        const limitDate = new Date()
        limitDate.setDate(limitDate.getDate() - org.dias_recordatorio)

        // Buscar órdenes completadas que no han sido retiradas
        const { data: ordenes } = await supabaseAdmin
          .from("ordenes_servicio")
          .select(`
            id,
            numero_orden,
            dispositivo,
            estado,
            fecha_completado,
            clientes (
              id,
              nombre,
              email,
              telefono
            )
          `)
          .eq("organization_id", org.id)
          .eq("estado", "REPARADO")
          .lt("fecha_completado", limitDate.toISOString())

        if (!ordenes || ordenes.length === 0) {
          return 0
        }

        // Verificar cuáles ya recibieron recordatorio hoy
        const today = new Date()
        today.setHours(0, 0, 0, 0)

        const { data: sentToday } = await supabaseAdmin
          .from("notification_logs")
          .select("orden_id")
          .eq("organization_id", org.id)
          .eq("tipo", "RECORDATORIO_RETIRO")
          .gte("created_at", today.toISOString())

        const sentTodayIds = new Set(sentToday?.map(n => n.orden_id) || [])

        // Filtrar órdenes que no han recibido recordatorio hoy
        const ordenesToNotify = ordenes.filter(o => !sentTodayIds.has(o.id))

        // Enviar eventos de notificación
        let count = 0
        for (const orden of ordenesToNotify) {
          const cliente = orden.clientes as unknown as {
            id: string
            nombre: string
            email: string | null
            telefono: string
          }

          await inngest.send({
            name: "notification/send",
            data: {
              organizationId: org.id,
              ordenId: orden.id,
              clienteId: cliente.id,
              tipo: "RECORDATORIO_RETIRO",
              context: {
                organizationName: org.nombre,
                cliente: {
                  id: cliente.id,
                  nombre: cliente.nombre,
                  email: cliente.email,
                  telefono: cliente.telefono,
                },
                orden: {
                  id: orden.id,
                  numeroOrden: orden.numero_orden,
                  dispositivo: orden.dispositivo,
                  estado: orden.estado,
                },
              },
            },
          })
          count++
        }

        return count
      })

      results.push({ orgId: org.id, sentCount })
    }

    return {
      success: true,
      organizationsProcessed: organizations.length,
      results,
      totalNotificationsSent: results.reduce((sum, r) => sum + r.sentCount, 0),
    }
  }
)

/**
 * Función para verificar garantías próximas a vencer
 * Se ejecuta diariamente
 */
export const checkExpiringWarranties = inngest.createFunction(
  {
    id: "check-expiring-warranties",
    name: "Check Expiring Warranties",
  },
  { cron: "0 9 * * *" }, // Todos los días a las 9:00 AM
  async ({ step }) => {
    // Obtener garantías que vencen en los próximos 7 días
    const inSevenDays = new Date()
    inSevenDays.setDate(inSevenDays.getDate() + 7)

    const today = new Date()

    const warranties = await step.run("get-expiring-warranties", async () => {
      const { data } = await supabaseAdmin
        .from("garantias")
        .select(`
          id,
          dias_validez,
          fecha_vencimiento,
          estado,
          ordenes_servicio (
            id,
            numero_orden,
            dispositivo,
            organization_id,
            organizations (
              id,
              nombre
            ),
            clientes (
              id,
              nombre,
              email,
              telefono
            )
          )
        `)
        .eq("estado", "ACTIVA")
        .gte("fecha_vencimiento", today.toISOString())
        .lte("fecha_vencimiento", inSevenDays.toISOString())

      return data || []
    })

    // Actualizar estado de garantías vencidas
    await step.run("update-expired-warranties", async () => {
      await supabaseAdmin
        .from("garantias")
        .update({ estado: "VENCIDA" })
        .eq("estado", "ACTIVA")
        .lt("fecha_vencimiento", today.toISOString())
    })

    return {
      success: true,
      expiringWarrantiesCount: warranties.length,
    }
  }
)
