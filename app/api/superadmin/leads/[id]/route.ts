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

    if (lead.visto === false) {
      supabaseAdmin
        .from("leads")
        .update({ visto: true })
        .eq("id", id)
        .then(({ error: markError }) => {
          if (markError) console.error("Error marking lead as visto:", markError)
        })
    }

    // Obtener conversaciones vinculadas con mensajes en un solo query (nested select)
    const { data: conversacionesConMensajes } = await supabaseAdmin
      .from("chatbot_conversaciones")
      .select(`
        id, session_id, ip_address, user_agent, referrer, created_at, activa, lead_capturado,
        chatbot_mensajes (id, tipo, contenido, modelo, tiempo_respuesta_ms, intencion_detectada, confianza, created_at)
      `)
      .eq("lead_id", id)
      .order("created_at", { ascending: false })

    // Renombrar nested key para mantener compatibilidad con el frontend
    const formattedConversaciones = (conversacionesConMensajes || []).map((conv) => ({
      ...conv,
      mensajes: (conv as any).chatbot_mensajes || [],
      chatbot_mensajes: undefined,
    }))

    return NextResponse.json({
      lead,
      conversaciones: formattedConversaciones,
    })
  } catch (err) {
    console.error("Error fetching lead detail:", err)
    return NextResponse.json({ error: "Error al obtener detalle del lead" }, { status: 500 })
  }
}
