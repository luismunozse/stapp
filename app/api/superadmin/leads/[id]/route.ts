import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireSuperadmin()
  if (error) return error

  try {
    const { id } = await params

    // Obtener lead
    const { data: lead, error: leadError } = await supabaseAdmin
      .from("leads")
      .select("*")
      .eq("id", id)
      .single()

    if (leadError || !lead) {
      return NextResponse.json({ error: "Lead no encontrado" }, { status: 404 })
    }

    // Obtener conversaciones vinculadas
    const { data: conversaciones } = await supabaseAdmin
      .from("chatbot_conversaciones")
      .select("id, session_id, ip_address, user_agent, referrer, created_at, activa, lead_capturado")
      .eq("lead_id", id)
      .order("created_at", { ascending: false })

    // Obtener mensajes de cada conversación
    const conversacionesConMensajes = await Promise.all(
      (conversaciones || []).map(async (conv) => {
        const { data: mensajes } = await supabaseAdmin
          .from("chatbot_mensajes")
          .select("id, tipo, contenido, modelo, tiempo_respuesta_ms, intencion_detectada, confianza, created_at")
          .eq("conversacion_id", conv.id)
          .order("created_at", { ascending: true })

        return { ...conv, mensajes: mensajes || [] }
      })
    )

    return NextResponse.json({
      lead,
      conversaciones: conversacionesConMensajes,
    })
  } catch (err) {
    console.error("Error fetching lead detail:", err)
    return NextResponse.json({ error: "Error al obtener detalle del lead" }, { status: 500 })
  }
}
