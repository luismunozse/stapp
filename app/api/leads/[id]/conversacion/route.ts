import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { error } = await requireAuth()
    if (error) return error

    const { id: leadId } = await params

    // Obtener conversación del lead
    const { data: conversacion, error: convError } = await supabaseAdmin
      .from("chatbot_conversaciones")
      .select("*")
      .eq("lead_id", leadId)
      .single()

    if (convError) {
      return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 })
    }

    // Obtener mensajes de la conversación
    const { data: mensajes, error: mensajesError } = await supabaseAdmin
      .from("chatbot_mensajes")
      .select("*")
      .eq("conversacion_id", conversacion.id)
      .order("created_at", { ascending: true })

    if (mensajesError) throw mensajesError

    return NextResponse.json({
      conversacion,
      mensajes,
    })
  } catch (error) {
    console.error("Error fetching conversación:", error)
    return NextResponse.json({ error: "Error al obtener conversación" }, { status: 500 })
  }
}
