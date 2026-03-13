import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { sendSupportReplyEmail } from "@/lib/email"
import { uploadSupportMessageAttachment, dataUrlToBuffer } from "@/lib/storage"
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
    const { error, email } = await requireSuperadmin()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const data = mensajeSchema.parse(body)

    // Verificar que el ticket existe y obtener datos del usuario
    const { data: ticket, error: fetchError } = await supabaseAdmin
      .from("support_tickets")
      .select(`
        id, estado, asunto,
        users:user_id (nombre, email),
        organizations:organization_id (slug)
      `)
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

    // Subir imágenes adjuntas si las hay
    const adjuntos: { id: string; url: string; nombreArchivo: string }[] = []
    if (data.imagenes && data.imagenes.length > 0) {
      for (const dataUrl of data.imagenes) {
        try {
          const { buffer, mime } = dataUrlToBuffer(dataUrl)
          if (buffer.length > MAX_IMAGE_SIZE_MB * 1024 * 1024) continue
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

    // Si el ticket estaba ABIERTO, moverlo a EN_PROCESO
    if (ticket.estado === "ABIERTO") {
      await supabaseAdmin
        .from("support_tickets")
        .update({ estado: "EN_PROCESO" })
        .eq("id", id)
    }

    // Notificar al usuario por email (sin bloquear la respuesta)
    const user = ticket.users as unknown as { nombre: string; email: string } | null
    const org = ticket.organizations as unknown as { slug: string } | null
    if (user?.email) {
      sendSupportReplyEmail({
        email: user.email,
        nombreUsuario: user.nombre || "Usuario",
        asuntoTicket: ticket.asunto,
        contenidoRespuesta: data.contenido,
        ticketId: id,
        slug: org?.slug || "",
      }).catch((err) => {
        console.error("Error enviando email de respuesta de soporte:", err)
      })
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
    console.error("Error creating superadmin message:", error)
    return NextResponse.json(
      { error: "Error al enviar mensaje" },
      { status: 500 }
    )
  }
}
