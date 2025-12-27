import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import {
  NotificationService,
  createNotificationContext,
} from "@/lib/notifications"

// Este endpoint puede ser llamado por:
// 1. Vercel Cron Jobs
// 2. Un servicio externo (cron-job.org, etc.)
// 3. Manualmente desde el dashboard

export async function GET(request: Request) {
  // Verificar API key para seguridad
  const authHeader = request.headers.get("authorization")
  const expectedKey = process.env.CRON_SECRET

  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  try {
    // Obtener todas las organizaciones con sus configuraciones
    const { data: organizations } = await supabaseAdmin
      .from("organizations")
      .select("id, dias_recordatorio, notificaciones_email")
      .eq("activo", true)

    if (!organizations) {
      return NextResponse.json({
        success: true,
        enviados: 0,
        errores: 0,
        timestamp: new Date().toISOString(),
      })
    }

    let totalEnviados = 0
    let totalErrores = 0

    for (const org of organizations) {
      if (!org.notificaciones_email) continue

      const diasLimite = org.dias_recordatorio || 3
      const fechaLimite = new Date()
      fechaLimite.setDate(fechaLimite.getDate() - diasLimite)

      // Buscar ordenes REPARADO que llevan mas de X dias sin retirar
      const { data: ordenesParaRecordar } = await supabaseAdmin
        .from("ordenes_servicio")
        .select(`
          id,
          clientes (email)
        `)
        .eq("organization_id", org.id)
        .eq("estado", "REPARADO")
        .lte("fecha_completado", fechaLimite.toISOString()) as {
          data: { id: string; clientes: { email: string | null } | null }[] | null
        }

      if (!ordenesParaRecordar) continue

      const notificationService = new NotificationService(org.id)
      const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString()

      for (const orden of ordenesParaRecordar) {
        // Verificar que no se haya enviado recordatorio hoy
        const { count } = await supabaseAdmin
          .from("notification_logs")
          .select("id", { count: "exact", head: true })
          .eq("orden_id", orden.id)
          .eq("tipo", "RECORDATORIO_RETIRO")
          .gte("created_at", todayStart)

        // Saltar si ya se envio recordatorio hoy
        if (count && count > 0) continue

        // Saltar si cliente no tiene email
        if (!orden.clientes?.email) continue

        const context = await createNotificationContext(orden.id)
        if (!context) continue

        try {
          const results = await notificationService.sendNotification(
            "RECORDATORIO_RETIRO",
            context,
            ["EMAIL"]
          )

          if (results[0]?.success) {
            totalEnviados++
          } else {
            totalErrores++
          }
        } catch (err) {
          console.error(
            `Error enviando recordatorio para orden ${orden.id}:`,
            err
          )
          totalErrores++
        }
      }
    }

    return NextResponse.json({
      success: true,
      enviados: totalEnviados,
      errores: totalErrores,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Error en cron de recordatorios:", error)
    return NextResponse.json(
      { error: "Error procesando recordatorios" },
      { status: 500 }
    )
  }
}
