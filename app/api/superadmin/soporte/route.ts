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
    const tipo = searchParams.get("tipo") || ""
    const search = searchParams.get("search") || ""
    const page = parseInt(searchParams.get("page") || "1")
    const limit = parseInt(searchParams.get("limit") || "20")
    const offset = (page - 1) * limit

    // Count query
    let countQuery = supabaseAdmin
      .from("support_tickets")
      .select("id", { count: "exact", head: true })

    if (estado) countQuery = countQuery.eq("estado", estado)
    if (prioridad) countQuery = countQuery.eq("prioridad", prioridad)
    if (tipo) countQuery = countQuery.eq("tipo", tipo)
    if (search) countQuery = countQuery.ilike("asunto", `%${search}%`)

    const { count } = await countQuery

    // Data query
    let query = supabaseAdmin
      .from("support_tickets")
      .select(`
        *,
        users:user_id (nombre, email),
        organizations:organization_id (nombre, slug),
        support_ticket_messages (id, autor_tipo, contenido, created_at, leido_at)
      `)
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (estado) {
      query = query.eq("estado", estado)
    }

    if (prioridad) {
      query = query.eq("prioridad", prioridad)
    }

    if (tipo) {
      query = query.eq("tipo", tipo)
    }

    if (search) {
      query = query.ilike("asunto", `%${search}%`)
    }

    const { data: tickets, error: dbError } = await query

    if (dbError) throw dbError

    const formatted = tickets?.map(t => {
      const mensajes = t.support_ticket_messages || []
      const sorted = [...mensajes].sort(
        (a: Record<string, unknown>, b: Record<string, unknown>) =>
          new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime()
      )
      const ultimo = sorted[0] as Record<string, unknown> | undefined
      const noLeidos = mensajes.filter(
        (m: Record<string, unknown>) => m.autor_tipo === "USUARIO" && !m.leido_at
      ).length

      return {
        id: t.id,
        tipo: t.tipo,
        prioridad: t.prioridad,
        asunto: t.asunto,
        estado: t.estado,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        usuario: t.users,
        organizacion: t.organizations,
        totalMensajes: mensajes.length,
        noLeidos,
        ultimoMensaje: ultimo
          ? {
              contenido: (ultimo.contenido as string)?.slice(0, 100) || "",
              autorTipo: ultimo.autor_tipo as string,
              createdAt: ultimo.created_at as string,
            }
          : null,
      }
    }) || []

    return NextResponse.json({ tickets: formatted, total: count || 0 })
  } catch (error) {
    console.error("Error fetching support tickets:", error)
    return NextResponse.json(
      { error: "Error al obtener tickets" },
      { status: 500 }
    )
  }
}
