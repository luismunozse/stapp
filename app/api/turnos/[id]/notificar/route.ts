import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { notifyTurno, type TurnoNotifTipo, type TurnoNotifCanal } from "@/lib/turnos/notifications"

const schema = z.object({
  tipo: z.enum([
    "confirmacion",
    "recordatorio_24h",
    "recordatorio_1h",
    "reprogramado",
    "cancelado",
    "tecnico_en_camino",
  ]),
  canales: z.array(z.enum(["whatsapp", "email"])).optional(),
})

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await ctx.params
    const body = await request.json()
    const { tipo, canales } = schema.parse(body)

    // Validar que turno pertenece a la org
    const { data: turno } = await supabaseAdmin
      .from("turnos")
      .select("id")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .maybeSingle()
    if (!turno) {
      return NextResponse.json({ error: "Turno no encontrado" }, { status: 404 })
    }

    const result = await notifyTurno(
      id,
      tipo as TurnoNotifTipo,
      canales as TurnoNotifCanal[] | undefined,
    )
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error sending turno notification:", err)
    return NextResponse.json({ error: "Error al enviar notificación" }, { status: 500 })
  }
}
