import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { uploadSupportMessageAttachment } from "@/lib/storage"
import { dataUrlToBuffer } from "@/lib/storage"
import { z } from "zod"

const MAX_IMAGES = 3
const MAX_IMAGE_SIZE_MB = 5

const mensajeSchema = z.object({
  contenido: z.string().min(1, "El mensaje no puede estar vacío"),
  imagenes: z.array(z.string()).max(MAX_IMAGES).optional(),
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

    // Subir imágenes adjuntas si las hay
    const adjuntos: { id: string; url: string; nombreArchivo: string }[] = []
    if (data.imagenes && data.imagenes.length > 0) {
      for (const dataUrl of data.imagenes) {
        try {
          const { buffer, mime } = dataUrlToBuffer(dataUrl)
          // Validar tamaño (MAX_IMAGE_SIZE_MB MB)
          if (buffer.length > MAX_IMAGE_SIZE_MB * 1024 * 1024) continue
          // Validar que sea imagen
          if (!mime.startsWith("image/")) continue

          const result = await uploadSupportMessageAttachment(id, mensaje.id, buffer, mime)
          const ext = mime.split("/")[1] || "img"
          const nombreArchivo = `imagen.${ext}`

          const { data: attachment } = await supabaseAdmin
            .from("support_ticket_attachments")
            .insert({
              ticket_id: id,
              message_id: mensaje.id,
              url: result.url,
              storage_path: result.path,
              mime,
              nombre_archivo: nombreArchivo,
            })
            .select("id, url, nombre_archivo")
            .single()

          if (attachment) {
            adjuntos.push({
              id: attachment.id,
              url: attachment.url,
              nombreArchivo: attachment.nombre_archivo,
            })
          }
        } catch (uploadErr) {
          console.error("Error uploading message attachment:", uploadErr)
        }
      }
    }

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
      adjuntos,
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
