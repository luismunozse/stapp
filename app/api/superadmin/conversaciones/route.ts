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
    const dateFrom = searchParams.get("dateFrom") || ""
    const dateTo = searchParams.get("dateTo") || ""
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

    if (dateFrom) {
      query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`)
    }
    if (dateTo) {
      query = query.lte("created_at", `${dateTo}T23:59:59.999Z`)
    }

    if (soloConLead) {
      query = query.not("lead_id", "is", null)
    }
    if (soloSinLead) {
      query = query.is("lead_id", null)
    }

    const { data, error: dbError, count } = await query

    if (dbError) throw dbError

    // Obtener IDs de conversaciones de esta página
    const convIds = (data || []).map((c) => c.id)

    // Batch: obtener todos los mensajes de estas conversaciones en UN solo query
    let mensajesMap: Record<string, { count: number; lastUserMsg: string | null; lastUserDate: string | null }> = {}
    if (convIds.length > 0) {
      const { data: allMensajes } = await supabaseAdmin
        .from("chatbot_mensajes")
        .select("id, conversacion_id, contenido, tipo, created_at")
        .in("conversacion_id", convIds)
        .order("created_at", { ascending: false })

      // Agrupar por conversación
      for (const msg of allMensajes || []) {
        if (!mensajesMap[msg.conversacion_id]) {
          mensajesMap[msg.conversacion_id] = { count: 0, lastUserMsg: null, lastUserDate: null }
        }
        mensajesMap[msg.conversacion_id].count++
        // Guardar solo el primer mensaje USER (ya viene ordenado desc)
        if (msg.tipo === "USER" && !mensajesMap[msg.conversacion_id].lastUserMsg) {
          mensajesMap[msg.conversacion_id].lastUserMsg = msg.contenido
          mensajesMap[msg.conversacion_id].lastUserDate = msg.created_at
        }
      }
    }

    const conversacionesEnriquecidas = (data || []).map((conv) => {
      const stats = mensajesMap[conv.id] || { count: 0, lastUserMsg: null, lastUserDate: null }
      return {
        ...conv,
        mensaje_count: stats.count,
        ultimo_mensaje_usuario: stats.lastUserMsg,
        ultimo_mensaje_fecha: stats.lastUserDate || conv.created_at,
      }
    })

    return NextResponse.json({
      conversaciones: conversacionesEnriquecidas,
      total: count || 0,
    })
  } catch (err) {
    console.error("Error fetching conversaciones:", err)
    return NextResponse.json({ error: "Error al obtener conversaciones" }, { status: 500 })
  }
}
