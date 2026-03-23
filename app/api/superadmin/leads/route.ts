import { NextRequest, NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(request: NextRequest) {
  const { error } = await requireSuperadmin()
  if (error) return error

  try {
    const { searchParams } = new URL(request.url)
    const estado = searchParams.get("estado")
    const origen = searchParams.get("origen")
    const search = searchParams.get("search")
    const limit = parseInt(searchParams.get("limit") || "50")
    const offset = parseInt(searchParams.get("offset") || "0")

    let query = supabaseAdmin
      .from("leads")
      .select("*, chatbot_conversaciones(id, session_id, created_at, lead_capturado)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (estado && estado !== "TODOS") {
      query = query.eq("estado", estado)
    }

    if (origen && origen !== "TODOS") {
      query = query.eq("origen", origen)
    }

    if (search) {
      query = query.or(
        `nombre.ilike.%${search}%,email.ilike.%${search}%,telefono.ilike.%${search}%,empresa.ilike.%${search}%`
      )
    }

    const { data, error: dbError, count } = await query

    if (dbError) throw dbError

    return NextResponse.json({ leads: data || [], total: count || 0 })
  } catch (err) {
    console.error("Error fetching leads:", err)
    return NextResponse.json({ error: "Error al obtener leads" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const { error } = await requireSuperadmin()
  if (error) return error

  try {
    const body = await request.json()
    const { id, ...updates } = body

    if (!id) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 })
    }

    const { data, error: dbError } = await supabaseAdmin
      .from("leads")
      .update({ ...updates, ultima_interaccion: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single()

    if (dbError) throw dbError

    return NextResponse.json(data)
  } catch (err) {
    console.error("Error updating lead:", err)
    return NextResponse.json({ error: "Error al actualizar lead" }, { status: 500 })
  }
}
