import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { requireCronAuth } from "@/lib/cron-auth"
import { HORA_RECORDATORIOS_LOCAL } from "@/lib/cron-config"
import { DEFAULT_TIMEZONE, getZonedParts } from "@/lib/timezone"
import { configGarantiasDeFila } from "@/lib/garantias/config"
import { avisarGarantiasPorVencerDeOrg } from "@/lib/garantias/aviso-vencimiento"

// El glob general de vercel.json (app/api/**) deja 30 s; los cron van a 60 s.
export const maxDuration = 60

/**
 * Aviso al cliente de las garantías que entran en la ventana "por vencer"
 * (migración 402; decisión 6 del doc de garantías: opcional, apagado por
 * defecto). Solo las orgs con organizations.garantia_aviso_vencimiento = true.
 *
 * Igual que /api/cron/recordatorios: Vercel lo dispara cada hora (UTC) y cada
 * org se procesa cuando en SU zona horaria son las HORA_RECORDATORIOS_LOCAL,
 * o sea una vez por día. `?force=1` saltea el filtro de hora (corrida manual
 * del superadmin). Correrlo de más no duplica avisos: cada garantía se marca
 * al avisarla (lib/garantias/aviso-vencimiento.ts).
 */

function resolverZonaHoraria(zonaHoraria: string | null): string {
  if (!zonaHoraria) return DEFAULT_TIMEZONE
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zonaHoraria })
    return zonaHoraria
  } catch {
    console.error(`cron garantias-por-vencer: zona_horaria invalida "${zonaHoraria}", usando ${DEFAULT_TIMEZONE}`)
    return DEFAULT_TIMEZONE
  }
}

export async function GET(request: Request) {
  const authError = requireCronAuth(request)
  if (authError) return authError

  try {
    const force = new URL(request.url).searchParams.get("force") === "1"
    const ahora = new Date()

    // select("*"): si la 402 no corrió, garantia_aviso_vencimiento falta, se lee
    // como apagado y no se avisa a nadie (en vez de tirar la corrida).
    const { data: organizations, error } = await supabaseAdmin
      .from("organizations")
      .select("*")
      .eq("activo", true)
      .eq("garantia_aviso_vencimiento", true)

    if (error) {
      // 42703: la columna todavía no existe (402 sin correr). Nada que avisar.
      if ((error as { code?: string }).code === "42703") {
        return NextResponse.json({ success: true, enviados: 0, errores: 0, orgsProcesadas: 0, timestamp: ahora.toISOString() })
      }
      throw error
    }

    let enviados = 0
    let omitidos = 0
    let errores = 0
    let orgsProcesadas = 0

    for (const org of (organizations ?? []) as Record<string, any>[]) {
      const config = configGarantiasDeFila(org)
      // Doble chequeo en memoria: la bandera es lo que decide, no solo el filtro.
      if (!config.avisoVencimiento) continue
      if (!org.notificaciones_email && !org.notificaciones_whatsapp) continue

      const zonaHoraria = resolverZonaHoraria(org.zona_horaria ?? null)
      if (!force && getZonedParts(ahora, zonaHoraria).hour !== HORA_RECORDATORIOS_LOCAL) continue

      orgsProcesadas++
      try {
        const r = await avisarGarantiasPorVencerDeOrg(
          {
            id: org.id,
            nombre: org.nombre_mostrar || org.nombre || "",
            slug: org.slug ?? null,
            moneda: org.moneda ?? null,
            zonaHoraria,
            ventana: config.ventanaPorVencer,
          },
          ahora
        )
        enviados += r.enviados
        omitidos += r.omitidos
        errores += r.errores
      } catch (err) {
        console.error(`cron garantias-por-vencer: org ${org.id}:`, err)
        errores++
      }
    }

    return NextResponse.json({
      success: true,
      enviados,
      omitidos,
      errores,
      orgsProcesadas,
      horaLocalObjetivo: HORA_RECORDATORIOS_LOCAL,
      forzado: force,
      timestamp: ahora.toISOString(),
    })
  } catch (error) {
    console.error("Error en cron de garantías por vencer:", error)
    return NextResponse.json({ error: "Error procesando avisos de garantías por vencer" }, { status: 500 })
  }
}
