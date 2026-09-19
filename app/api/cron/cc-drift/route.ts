import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { requireCronAuth } from "@/lib/cron-auth"
import {
  leerDrift,
  agruparPorOrganizacion,
  mensajeDrift,
} from "@/lib/cuenta-corriente-drift"

/**
 * Aviso diario de cuentas corrientes descuadradas.
 *
 * Auditoría contable, punto 1.7: la vista `v_cc_drift` (migración 245)
 * detecta cuando el saldo de un cliente no coincide con la suma de sus
 * movimientos. Existía desde hace meses y no la consultaba nadie — ni cron,
 * ni pantalla, ni alerta.
 *
 * Esto la corre una vez por día y le avisa a los administradores del taller
 * afectado. No arregla el descuadre: lo pone a la vista, que es lo que
 * faltaba. La causa de fondo (los flujos que toleran que el registro en
 * cuenta corriente falle y siguen adelante) es otro trabajo.
 *
 * NO MANDA EL MISMO AVISO TODOS LOS DÍAS
 *
 * Un descuadre que nadie resolvió sigue apareciendo mañana. Avisar todos los
 * días del mismo problema entrena a la gente a ignorar las notificaciones, y
 * entonces el detector vuelve a no servir. Por eso sólo se notifica si en los
 * últimos 7 días no se avisó a ese taller.
 */

const TIPO_NOTIFICACION = "CC_DESCUADRADA"
const DIAS_ENTRE_AVISOS = 7

export async function GET(request: Request) {
  const authError = requireCronAuth(request)
  if (authError) return authError

  try {
    const { filas, vistaAusente } = await leerDrift()

    if (vistaAusente) {
      return NextResponse.json({
        ok: true,
        vistaAusente: true,
        mensaje: "v_cc_drift no está creada: aplicar la migración 245.",
      })
    }

    const porOrg = agruparPorOrganizacion(filas)

    if (porOrg.size === 0) {
      return NextResponse.json({ ok: true, organizacionesConDrift: 0, avisos: 0 })
    }

    const corte = new Date(Date.now() - DIAS_ENTRE_AVISOS * 24 * 60 * 60 * 1000).toISOString()
    let avisos = 0
    const silenciadas: string[] = []

    for (const [organizationId, resumen] of porOrg) {
      // ¿Ya avisamos hace poco?
      const { data: reciente } = await supabaseAdmin
        .from("user_notifications")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("type", TIPO_NOTIFICACION)
        .gte("created_at", corte)
        .limit(1)
        .maybeSingle()

      if (reciente) {
        silenciadas.push(organizationId)
        continue
      }

      // Mismo criterio que el aviso de solicitudes del catálogo: los ADMIN
      // de la org. `users` no tiene columna `activo` (la baja se maneja por
      // otro lado), así que no hay filtro extra que agregar acá.
      const { data: admins } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("rol", "ADMIN")

      if (!admins || admins.length === 0) continue

      const { error: insertError } = await supabaseAdmin.from("user_notifications").insert(
        admins.map((u) => ({
          organization_id: organizationId,
          user_id: u.id,
          title: "Revisá las cuentas corrientes",
          body: mensajeDrift(resumen),
          type: TIPO_NOTIFICACION,
          icon: "alert-triangle",
          action_url: "/clientes?conDeuda=true",
        }))
      )

      if (insertError) {
        // Un taller que falla no puede cortar el aviso de los demás.
        console.error(`Error notificando drift de CC en ${organizationId}:`, insertError)
        continue
      }

      avisos++
    }

    return NextResponse.json({
      ok: true,
      organizacionesConDrift: porOrg.size,
      avisos,
      silenciadas: silenciadas.length,
      filas: filas.length,
    })
  } catch (err) {
    console.error("Error en cron cc-drift:", err)
    return NextResponse.json({ error: "Error al revisar cuentas corrientes" }, { status: 500 })
  }
}
