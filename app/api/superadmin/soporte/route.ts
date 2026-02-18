import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(request: Request) {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const estado = searchParams.get("estado") || ""
    const prioridad = searchParams.get("prioridad") || ""
    const search = searchParams.get("search") || ""

    let query = supabaseAdmin
      .from("support_tickets")
      .select(`
        *,
        users:user_id (nombre, email),
        organizations:organization_id (nombre, slug),
        support_ticket_messages (id)
      `)
      .order("updated_at", { ascending: false })

    if (estado) {
      query = query.eq("estado", estado)
    }

    if (prioridad) {
      query = query.eq("prioridad", prioridad)
    }

    if (search) {
      query = query.ilike("asunto", `%${search}%`)
    }

    const { data: tickets, error: dbError } = await query

    if (dbError) throw dbError

    const formatted = tickets?.map(t => ({
      id: t.id,
      tipo: t.tipo,
      prioridad: t.prioridad,
      asunto: t.asunto,
      estado: t.estado,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      usuario: t.users,
      organizacion: t.organizations,
      totalMensajes: t.support_ticket_messages?.length || 0,
    })) || []

    return NextResponse.json(formatted)
  } catch (error) {
    console.error("Error fetching support tickets:", error)
    return NextResponse.json(
      { error: "Error al obtener tickets" },
      { status: 500 }
    )
  }
}
