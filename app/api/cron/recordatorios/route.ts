import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { queueNotification } from "@/lib/notifications/queue"
import { requireCronAuth } from "@/lib/cron-auth"
import { resolveTerminologia } from "@/lib/terminologia"
import { HORA_RECORDATORIOS_LOCAL } from "@/lib/cron-config"
import { DEFAULT_TIMEZONE, dayRangeUtc, getZonedParts, todayInTimeZone } from "@/lib/timezone"

// Este endpoint puede ser llamado por:
// 1. Vercel Cron Jobs
// 2. Un servicio externo (cron-job.org, etc.)
// 3. Manualmente desde el dashboard
//
// Los cron de Vercel corren SIEMPRE en UTC, así que este endpoint se agenda
// cada hora y decide por organización si le toca enviar: sólo procesa las orgs
// donde ya son las HORA_RECORDATORIOS_LOCAL en SU zona horaria. Con `?force=1`
// se saltea el filtro (lo usa la corrida manual del superadmin).

/**
 * Zona horaria usable de la org. `configuracion` valida la tz contra Intl antes
 * de guardarla, pero una fila cargada por migración o a mano podría traer basura,
 * e `Intl` tira RangeError: sin este guard una sola org rota abortaba la corrida
 * completa y ningún taller recibía sus recordatorios.
 */
function resolverZonaHoraria(zonaHoraria: string | null): string {
  if (!zonaHoraria) return DEFAULT_TIMEZONE
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zonaHoraria })
    return zonaHoraria
  } catch {
    console.error(`cron recordatorios: zona_horaria invalida "${zonaHoraria}", usando ${DEFAULT_TIMEZONE}`)
    return DEFAULT_TIMEZONE
  }
}

export async function GET(request: Request) {
  const authError = requireCronAuth(request)
  if (authError) return authError

  try {
    const force = new URL(request.url).searchParams.get("force") === "1"
    const ahora = new Date()
    // Obtener todas las organizaciones con sus configuraciones
    const { data: organizations } = await supabaseAdmin
      .from("organizations")
      .select("id, nombre, nombre_mostrar, slug, dias_recordatorio, notificaciones_email, notificaciones_whatsapp, moneda, zona_horaria, terminologia")
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
    let totalOrgsProcesadas = 0

    for (const org of organizations) {
      if (!org.notificaciones_email && !org.notificaciones_whatsapp) continue

      // Sólo enviar cuando en la zona horaria de la org ya son las 10 de la
      // mañana. Sin este filtro, un único disparo a las 10:00 UTC le llega
      // 04:00 a un taller en UTC-6.
      const zonaHoraria = resolverZonaHoraria(org.zona_horaria)
      if (!force && getZonedParts(ahora, zonaHoraria).hour !== HORA_RECORDATORIOS_LOCAL) continue

      totalOrgsProcesadas++

      const diasLimite = org.dias_recordatorio || 3
      const fechaLimite = new Date(ahora)
      fechaLimite.setDate(fechaLimite.getDate() - diasLimite)

      // Buscar ordenes REPARADO que llevan mas de X dias sin retirar
      const { data: ordenesParaRecordar } = await supabaseAdmin
        .from("ordenes_servicio")
        .select(`
          id,
          numero_orden,
          dispositivo,
          public_token,
          sucursal_id,
          clientes (id, nombre, email, telefono)
        `)
        .eq("organization_id", org.id)
        .eq("estado", "REPARADO")
        .lte("fecha_completado", fechaLimite.toISOString()) as {
          data: {
            id: string
            numero_orden: number
            dispositivo: string
            public_token: string | null
            sucursal_id: string | null
            clientes: { id: string; nombre: string; email: string | null; telefono: string | null } | null
          }[] | null
        }

      if (!ordenesParaRecordar) continue

      // Inicio del día calendario de la org. `setHours(0,0,0,0)` usaba la tz del
      // proceso (UTC en Vercel, otra en local), así que la ventana anti-duplicado
      // no coincidía con el día del taller.
      const { desde: todayStart } = dayRangeUtc(todayInTimeZone(zonaHoraria, ahora), zonaHoraria)

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

        // Saltar si cliente no tiene ningun canal de contacto
        if (!orden.clientes?.email && !orden.clientes?.telefono) continue

        try {
          await queueNotification({
            organizationId: org.id,
            sucursalId: orden.sucursal_id,
            ordenId: orden.id,
            clienteId: orden.clientes!.id,
            tipo: "RECORDATORIO_RETIRO",
            context: {
              organizationName: org.nombre_mostrar || org.nombre,
              organizationSlug: org.slug,
              moneda: org.moneda || "ARS",
              zonaHoraria: zonaHoraria,
              terminologia: resolveTerminologia((org as any).terminologia ?? null),
              cliente: {
                id: orden.clientes!.id,
                nombre: orden.clientes!.nombre,
                email: orden.clientes!.email,
                telefono: orden.clientes!.telefono ?? "",
              },
              orden: {
                id: orden.id,
                numeroOrden: orden.numero_orden,
                dispositivo: orden.dispositivo,
                estado: "REPARADO",
                publicToken: orden.public_token,
              },
            },
          })
          totalEnviados++
        } catch (err) {
          console.error(`Error recordatorio orden ${orden.id}:`, err)
          totalErrores++
        }
      }
    }

    return NextResponse.json({
      success: true,
      enviados: totalEnviados,
      errores: totalErrores,
      orgsProcesadas: totalOrgsProcesadas,
      horaLocalObjetivo: HORA_RECORDATORIOS_LOCAL,
      forzado: force,
      timestamp: ahora.toISOString(),
    })
  } catch (error) {
    console.error("Error en cron de recordatorios:", error)
    return NextResponse.json(
      { error: "Error procesando recordatorios" },
      { status: 500 }
    )
  }
}
