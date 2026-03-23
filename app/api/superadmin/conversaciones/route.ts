import { NextRequest, NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(request: NextRequest) {
  const { error } = await requireSuperadmin()
  if (error) return error

  try {
    const { searchParams } = new URL(request.url)
    const soloConLead = searchParams.get("solo_con_lead") === "true"
    const soloSinLead = searchParams.get("solo_sin_lead") === "true"
    const limit = parseInt(searchParams.get("limit") || "50")
    const offset = parseInt(searchParams.get("offset") || "0")

    let query = supabaseAdmin
      .from("chatbot_conversaciones")
      .select(
        "id, session_id, ip_address, referrer, created_at, activa, lead_capturado, lead_id, leads(id, nombre, email, telefono, estado)",
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (soloConLead) {
      query = query.not("lead_id", "is", null)
    }
    if (soloSinLead) {
      query = query.is("lead_id", null)
    }

    const { data, error: dbError, count } = await query

    if (dbError) throw dbError

    // Para cada conversación, obtener el conteo de mensajes y el último mensaje
    const conversacionesEnriquecidas = await Promise.all(
      (data || []).map(async (conv) => {
        const { count: msgCount } = await supabaseAdmin
          .from("chatbot_mensajes")
          .select("id", { count: "exact", head: true })
          .eq("conversacion_id", conv.id)

        const { data: ultimoMsg } = await supabaseAdmin
          .from("chatbot_mensajes")
          .select("contenido, tipo, created_at")
          .eq("conversacion_id", conv.id)
          .eq("tipo", "USER")
          .order("created_at", { ascending: false })
          .limit(1)

        return {
          ...conv,
          mensaje_count: msgCount || 0,
          ultimo_mensaje_usuario: ultimoMsg?.[0]?.contenido || null,
          ultimo_mensaje_fecha: ultimoMsg?.[0]?.created_at || conv.created_at,
        }
      })
    )

    return NextResponse.json({
      conversaciones: conversacionesEnriquecidas,
      total: count || 0,
    })
  } catch (err) {
    console.error("Error fetching conversaciones:", err)
    return NextResponse.json({ error: "Error al obtener conversaciones" }, { status: 500 })
  }
}
