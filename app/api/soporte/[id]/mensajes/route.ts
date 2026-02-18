import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const mensajeSchema = z.object({
  contenido: z.string().min(1, "El mensaje no puede estar vacío"),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId } = await requireAuth()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const data = mensajeSchema.parse(body)

    // Verificar que el ticket existe y pertenece a la org
    const { data: ticket, error: fetchError } = await supabaseAdmin
      .from("support_tickets")
      .select("id, estado")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !ticket) {
      return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 })
    }

    if (ticket.estado === "CERRADO") {
      return NextResponse.json(
        { error: "No se pueden enviar mensajes a un ticket cerrado" },
        { status: 400 }
      )
    }

    // Obtener nombre del usuario
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("nombre")
      .eq("id", userId!)
      .single()

    // Crear mensaje
    const { data: mensaje, error: msgError } = await supabaseAdmin
      .from("support_ticket_messages")
      .insert({
        ticket_id: id,
        autor_tipo: "USUARIO",
        autor_id: userId!,
        autor_nombre: user?.nombre || "Usuario",
        contenido: data.contenido,
      })
      .select()
      .single()

    if (msgError) throw msgError

    // Si el ticket estaba RESUELTO, reabrirlo
    if (ticket.estado === "RESUELTO") {
      await supabaseAdmin
        .from("support_tickets")
        .update({ estado: "ABIERTO" })
        .eq("id", id)
    }

    return NextResponse.json({
      id: mensaje.id,
      autorTipo: mensaje.autor_tipo,
      autorNombre: mensaje.autor_nombre,
      contenido: mensaje.contenido,
      createdAt: mensaje.created_at,
    }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error creating message:", error)
    return NextResponse.json(
      { error: "Error al enviar mensaje" },
      { status: 500 }
    )
  }
}
