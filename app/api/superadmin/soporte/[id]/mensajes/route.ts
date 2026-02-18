import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
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
    const { error, email } = await requireSuperadmin()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const data = mensajeSchema.parse(body)

    // Verificar que el ticket existe
    const { data: ticket, error: fetchError } = await supabaseAdmin
      .from("support_tickets")
      .select("id, estado")
      .eq("id", id)
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

    // Crear mensaje como superadmin
    const { data: mensaje, error: msgError } = await supabaseAdmin
      .from("support_ticket_messages")
      .insert({
        ticket_id: id,
        autor_tipo: "SUPERADMIN",
        autor_id: email!,
        autor_nombre: "Soporte STApp",
        contenido: data.contenido,
      })
      .select()
      .single()

    if (msgError) throw msgError

    // Si el ticket estaba ABIERTO, moverlo a EN_PROCESO
    if (ticket.estado === "ABIERTO") {
      await supabaseAdmin
        .from("support_tickets")
        .update({ estado: "EN_PROCESO" })
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
    console.error("Error creating superadmin message:", error)
    return NextResponse.json(
      { error: "Error al enviar mensaje" },
      { status: 500 }
    )
  }
}
