import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params

    const { data: ticket, error: dbError } = await supabaseAdmin
      .from("support_tickets")
      .select(`
        *,
        users:user_id (nombre, email),
        support_ticket_messages (
          id, autor_tipo, autor_id, autor_nombre, contenido, created_at
        ),
        support_ticket_attachments (
          id, message_id, url, nombre_archivo, mime, created_at
        )
      `)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (dbError) {
      if (dbError.code === "PGRST116") {
        return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 })
      }
      throw dbError
    }

    // Ordenar mensajes por fecha ascendente
    const mensajes = (ticket.support_ticket_messages || [])
      .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map((m: any) => ({
        id: m.id,
        autorTipo: m.autor_tipo,
        autorId: m.autor_id,
        autorNombre: m.autor_nombre,
        contenido: m.contenido,
        createdAt: m.created_at,
      }))

    const adjuntos = (ticket.support_ticket_attachments || []).map((a: any) => ({
      id: a.id,
      messageId: a.message_id,
      url: a.url,
      nombreArchivo: a.nombre_archivo,
      createdAt: a.created_at,
    }))

    return NextResponse.json({
      id: ticket.id,
      tipo: ticket.tipo,
      prioridad: ticket.prioridad,
      asunto: ticket.asunto,
      descripcion: ticket.descripcion,
      estado: ticket.estado,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at,
      usuario: ticket.users,
      mensajes,
      adjuntos,
    })
  } catch (error) {
    console.error("Error fetching ticket:", error)
    return NextResponse.json(
      { error: "Error al obtener ticket" },
      { status: 500 }
    )
  }
}
