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
          id, autor_tipo, autor_id, autor_nombre, contenido, created_at, leido_at
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

    // Mapear adjuntos por message_id
    const allAttachments = (ticket.support_ticket_attachments || []).map((a: Record<string, unknown>) => ({
      id: a.id as string,
      messageId: a.message_id as string | null,
      url: a.url as string,
      nombreArchivo: a.nombre_archivo as string | null,
      createdAt: a.created_at as string,
    }))

    const attachmentsByMessage = new Map<string, typeof allAttachments>()
    for (const att of allAttachments) {
      if (att.messageId) {
        const existing = attachmentsByMessage.get(att.messageId) || []
        existing.push(att)
        attachmentsByMessage.set(att.messageId, existing)
      }
    }

    const mensajes = (ticket.support_ticket_messages || [])
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
        new Date(a.created_at as string).getTime() - new Date(b.created_at as string).getTime()
      )
      .map((m: Record<string, unknown>) => ({
        id: m.id as string,
        autorTipo: m.autor_tipo as string,
        autorId: m.autor_id as string,
        autorNombre: m.autor_nombre as string,
        contenido: m.contenido as string,
        createdAt: m.created_at as string,
        leidoAt: (m.leido_at as string) || null,
        adjuntos: attachmentsByMessage.get(m.id as string) || [],
      }))

    const adjuntos = allAttachments.filter((a: { messageId: string | null }) => !a.messageId)

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
