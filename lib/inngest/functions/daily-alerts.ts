import { inngest } from "../client"
import { supabaseAdmin } from "@/lib/supabase"
import { sendAlertDigestEmail } from "@/lib/email"
import { formatCurrencyValue, type CurrencyCode } from "@/lib/currency"

/**
 * Función cron que se ejecuta diariamente para detectar alertas
 * y notificar a los admins de cada organización:
 * - Stock bajo
 * - Órdenes con fecha prometida vencida
 * - Órdenes sin cobrar (deuda pendiente)
 */
export const dailyAlerts = inngest.createFunction(
  {
    id: "daily-alerts",
    name: "Daily Alert Notifications",
  },
  { cron: "0 8 * * *" }, // Todos los días a las 8:00 AM
  async ({ step }) => {
    // Paso 1: Obtener organizaciones activas
    const organizations = await step.run("get-organizations", async () => {
      const { data } = await supabaseAdmin
        .from("organizations")
        .select("id, nombre, moneda, slug")
        .eq("activo", true)

      return data || []
    })

    const results: Array<{ orgId: string; alertsSent: number }> = []

    // Paso 2: Procesar cada organización
    for (const org of organizations) {
      const alertsSent = await step.run(`check-alerts-${org.id}`, async () => {
        const hoy = new Date()
        const moneda = (org.moneda || "ARS") as CurrencyCode

        // Consultas en paralelo para detectar alertas
        const [
          stockBajoResult,
          fechaVencidaResult,
          sinCobrarResult,
        ] = await Promise.all([
          // Items con stock bajo
          supabaseAdmin
            .from("inventario")
            .select("id, nombre, stock, stock_minimo")
            .eq("organization_id", org.id)
            .lt("stock", 5)
            .order("stock", { ascending: true })
            .limit(10),

          // Órdenes con fecha prometida vencida
          supabaseAdmin
            .from("ordenes_servicio")
            .select(`
              id, numero_orden, codigo_orden, dispositivo, estado, fecha_prometida,
              clientes (nombre)
            `)
            .eq("organization_id", org.id)
            .in("estado", ["RECIBIDO", "EN_DIAGNOSTICO", "PRESUPUESTADO", "APROBADO", "EN_REPARACION", "ESPERANDO_REPUESTO"])
            .lt("fecha_prometida", hoy.toISOString())
            .not("fecha_prometida", "is", null),

          // Órdenes sin cobrar
          supabaseAdmin
            .from("ordenes_servicio")
            .select(`
              id, numero_orden, codigo_orden, costo_final, total_cobrado, descuento_cobro,
              estado_cobro, fecha_ingreso,
              clientes (nombre)
            `)
            .eq("organization_id", org.id)
            .in("estado_cobro", ["PENDIENTE", "PARCIAL"])
            .in("estado", ["REPARADO", "ENTREGADO"])
            .gt("costo_final", 0),
        ])

        const stockBajo = stockBajoResult.data || []
        const fechaVencida = fechaVencidaResult.data || []
        const sinCobrarRaw = (sinCobrarResult.data || [])
          .map((o: any) => ({
            ...o,
            pendiente: parseFloat(o.costo_final || 0) - parseFloat(o.descuento_cobro || 0) - parseFloat(o.total_cobrado || 0),
          }))
          .filter((o: any) => o.pendiente > 0)

        const totalDeuda = sinCobrarRaw.reduce((sum: number, o: any) => sum + o.pendiente, 0)

        // Si no hay alertas, no enviar nada
        if (stockBajo.length === 0 && fechaVencida.length === 0 && sinCobrarRaw.length === 0) {
          return 0
        }

        // Verificar que no se envió alerta hoy
        const todayStart = new Date()
        todayStart.setHours(0, 0, 0, 0)

        const { data: sentToday } = await supabaseAdmin
          .from("user_notifications")
          .select("id")
          .eq("organization_id", org.id)
          .eq("type", "ALERTA_DIARIA")
          .gte("created_at", todayStart.toISOString())
          .limit(1)

        if (sentToday && sentToday.length > 0) {
          return 0 // Ya se envió hoy
        }

        // Obtener admins de la organización
        const { data: admins } = await supabaseAdmin
          .from("users")
          .select("id, email, nombre")
          .eq("organization_id", org.id)
          .eq("rol", "ADMIN")

        if (!admins || admins.length === 0) return 0

        // Construir alertas
        const alertas: Array<{ tipo: string; titulo: string; detalle: string; cantidad: number; icono: string }> = []

        if (stockBajo.length > 0) {
          alertas.push({
            tipo: "INVENTARIO_BAJO",
            titulo: `${stockBajo.length} item${stockBajo.length > 1 ? "s" : ""} con stock bajo`,
            detalle: stockBajo.slice(0, 3).map((i: any) => `${i.nombre} (${i.stock} uds)`).join(", "),
            cantidad: stockBajo.length,
            icono: "package",
          })
        }

        if (fechaVencida.length > 0) {
          alertas.push({
            tipo: "FECHA_VENCIDA",
            titulo: `${fechaVencida.length} orden${fechaVencida.length > 1 ? "es" : ""} con fecha prometida vencida`,
            detalle: fechaVencida.slice(0, 3).map((o: any) => {
              const dias = Math.floor((Date.now() - new Date(o.fecha_prometida).getTime()) / (1000 * 60 * 60 * 24))
              return `${o.codigo_orden || `#${o.numero_orden}`} - ${(o.clientes as any)?.nombre || "Sin cliente"} (${dias}d atraso)`
            }).join(", "),
            cantidad: fechaVencida.length,
            icono: "clock",
          })
        }

        if (sinCobrarRaw.length > 0) {
          alertas.push({
            tipo: "DEUDA_PENDIENTE",
            titulo: `${sinCobrarRaw.length} orden${sinCobrarRaw.length > 1 ? "es" : ""} sin cobrar`,
            detalle: `Total pendiente: ${formatCurrencyValue(totalDeuda, moneda)}`,
            cantidad: sinCobrarRaw.length,
            icono: "dollar-sign",
          })
        }

        // Crear notificaciones in-app para cada admin
        const notifications = admins.flatMap((admin) =>
          alertas.map((alerta) => ({
            organization_id: org.id,
            user_id: admin.id,
            title: alerta.titulo,
            body: alerta.detalle,
            type: alerta.tipo === "INVENTARIO_BAJO" ? "INVENTARIO_BAJO" : "ALERTA_DIARIA",
            icon: alerta.icono,
            action_url: alerta.tipo === "INVENTARIO_BAJO" ? "/inventario" :
                         alerta.tipo === "FECHA_VENCIDA" ? "/ordenes" :
                         "/ordenes",
          }))
        )

        const { error: insertError } = await supabaseAdmin
          .from("user_notifications")
          .insert(notifications)

        if (insertError) {
          console.error(`Error creating alert notifications for org ${org.id}:`, insertError)
        }

        // Enviar email digest a cada admin
        for (const admin of admins) {
          if (admin.email) {
            try {
              await sendAlertDigestEmail({
                to: admin.email,
                nombre: admin.nombre || "Admin",
                organizationName: org.nombre,
                slug: org.slug,
                alertas,
                moneda,
              })
            } catch (emailError) {
              console.error(`Error sending alert email to ${admin.email}:`, emailError)
            }
          }
        }

        return notifications.length
      })

      results.push({ orgId: org.id, alertsSent })
    }

    return {
      success: true,
      organizationsProcessed: organizations.length,
      results,
      totalAlertsSent: results.reduce((sum, r) => sum + r.alertsSent, 0),
    }
  }
)
