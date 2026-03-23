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

    const { data: conversacion, error: convError } = await supabaseAdmin
      .from("chatbot_conversaciones")
      .select("*, leads(id, nombre, email, telefono, empresa, estado, origen)")
      .eq("id", id)
      .single()

    if (convError || !conversacion) {
      return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 })
    }

    const { data: mensajes } = await supabaseAdmin
      .from("chatbot_mensajes")
      .select("id, tipo, contenido, modelo, tiempo_respuesta_ms, intencion_detectada, confianza, created_at")
      .eq("conversacion_id", id)
      .order("created_at", { ascending: true })

    return NextResponse.json({
      conversacion,
      mensajes: mensajes || [],
    })
  } catch (err) {
    console.error("Error fetching conversacion detail:", err)
    return NextResponse.json({ error: "Error al obtener conversación" }, { status: 500 })
  }
}
