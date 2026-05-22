import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { notifyTurno } from "@/lib/turnos/notifications"
import { requireCronAuth } from "@/lib/cron-auth"

// Cron: recorre turnos con inicio en las próximas ~24h que aún no
// recibieron recordatorio_24h, y dispara la notificación.
// Llamar 1 vez por hora (o cada 30min).
//
// Auth: Bearer ${CRON_SECRET}
//
// Ventana: turnos con inicio entre +23h y +25h desde ahora.
// Esto da tolerancia para que un cron horario nunca pierda turnos.
// Se evita doble envío chequeando turno_notificaciones existente
// del mismo tipo + turno.

export async function GET(request: Request) {
  const authError = requireCronAuth(request)
  if (authError) return authError

  const now = new Date()
  const desde = new Date(now.getTime() + 23 * 60 * 60 * 1000)
  const hasta = new Date(now.getTime() + 25 * 60 * 60 * 1000)

  const { data: turnos, error } = await supabaseAdmin
    .from("turnos")
    .select("id, organization_id, inicio, estado")
    .gte("inicio", desde.toISOString())
    .lte("inicio", hasta.toISOString())
    .in("estado", ["agendado", "confirmado"])

  if (error) {
    console.error("cron turnos-recordatorios error:", error)
    return NextResponse.json({ error: "DB error" }, { status: 500 })
  }

  if (!turnos || turnos.length === 0) {
    return NextResponse.json({ ok: true, enviados: 0, evaluados: 0 })
  }

  let enviados = 0
  let saltados = 0
  let errores = 0

  for (const t of turnos) {
    // Skip si ya hay recordatorio_24h registrado
    const { data: prev } = await supabaseAdmin
      .from("turno_notificaciones")
      .select("id")
      .eq("turno_id", t.id)
      .eq("tipo", "recordatorio_24h")
      .eq("estado", "ENVIADO")
      .limit(1)
      .maybeSingle()
    if (prev) { saltados++; continue }

    try {
      await notifyTurno(t.id, "recordatorio_24h")
      enviados++
    } catch (err) {
      console.error("notify recordatorio_24h error:", err)
      errores++
    }
  }

  return NextResponse.json({
    ok: true,
    evaluados: turnos.length,
    enviados,
    saltados,
    errores,
    ventana: { desde: desde.toISOString(), hasta: hasta.toISOString() },
  })
}
