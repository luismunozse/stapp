import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const updateSchema = z.object({
  estado: z.enum(["ABIERTO", "EN_PROCESO", "RESUELTO", "CERRADO"]),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { id } = await params

    const { data: ticket, error: dbError } = await supabaseAdmin
      .from("support_tickets")
      .select(`
        *,
        users:user_id (nombre, email),
        organizations:organization_id (nombre, slug),
        support_ticket_messages (
          id, autor_tipo, autor_id, autor_nombre, contenido, created_at
        ),
        support_ticket_attachments (
          id, message_id, url, nombre_archivo, mime, created_at
        )
      `)
      .eq("id", id)
      .single()

    if (dbError) {
      if (dbError.code === "PGRST116") {
        return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 })
      }
      throw dbError
    }

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
      organizacion: ticket.organizations,
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const data = updateSchema.parse(body)

    const { data: ticket, error: dbError } = await supabaseAdmin
      .from("support_tickets")
      .update({ estado: data.estado })
      .eq("id", id)
      .select()
      .single()

    if (dbError) throw dbError

    return NextResponse.json({
      id: ticket.id,
      estado: ticket.estado,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error updating ticket:", error)
    return NextResponse.json(
      { error: "Error al actualizar ticket" },
      { status: 500 }
    )
  }
}
