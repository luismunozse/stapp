import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin, STORAGE_BUCKETS } from "@/lib/supabase"
import { z } from "zod"
import { v4 as uuidv4 } from "uuid"

const ticketSchema = z.object({
  tipo: z.enum(["BUG", "SUGERENCIA", "PREGUNTA"]),
  prioridad: z.enum(["BAJA", "MEDIA", "ALTA"]).default("MEDIA"),
  asunto: z.string().min(5, "El asunto debe tener al menos 5 caracteres").max(200),
  descripcion: z.string().min(10, "La descripción debe tener al menos 10 caracteres"),
  imagenes: z.array(z.object({
    data: z.string(),
    mime: z.string(),
  })).max(3).optional(),
})

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const estado = searchParams.get("estado") || ""

    let query = supabaseAdmin
      .from("support_tickets")
      .select(`
        *,
        users:user_id (nombre, email),
        support_ticket_messages (id),
        support_ticket_attachments (id, url, nombre_archivo)
      `)
      .eq("organization_id", organizationId!)
      .order("created_at", { ascending: false })

    if (estado) {
      query = query.eq("estado", estado)
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
      totalMensajes: t.support_ticket_messages?.length || 0,
      tieneAdjuntos: (t.support_ticket_attachments?.length || 0) > 0,
    })) || []

    return NextResponse.json(formatted)
  } catch (error) {
    console.error("Error fetching tickets:", error)
    return NextResponse.json(
      { error: "Error al obtener tickets" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const { error, organizationId, userId } = await requireAuth()
    if (error) return error

    const body = await request.json()
    const data = ticketSchema.parse(body)

    // Obtener nombre del usuario
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("nombre")
      .eq("id", userId!)
      .single()

    // Crear ticket
    const { data: ticket, error: dbError } = await supabaseAdmin
      .from("support_tickets")
      .insert({
        organization_id: organizationId!,
        user_id: userId!,
        tipo: data.tipo,
        prioridad: data.prioridad,
        asunto: data.asunto,
        descripcion: data.descripcion,
      })
      .select()
      .single()

    if (dbError) throw dbError

    // Crear mensaje inicial con la descripción
    await supabaseAdmin
      .from("support_ticket_messages")
      .insert({
        ticket_id: ticket.id,
        autor_tipo: "USUARIO",
        autor_id: userId!,
        autor_nombre: user?.nombre || "Usuario",
        contenido: data.descripcion,
      })

    // Subir imágenes adjuntas
    if (data.imagenes && data.imagenes.length > 0) {
      for (const img of data.imagenes) {
        const base64Data = img.data.replace(/^data:image\/\w+;base64,/, "")
        const buffer = Buffer.from(base64Data, "base64")
        const ext = img.mime.split("/")[1] || "png"
        const fileName = `${uuidv4()}.${ext}`
        const path = `${organizationId}/${ticket.id}/${fileName}`

        const { error: uploadError } = await supabaseAdmin.storage
          .from(STORAGE_BUCKETS.SOPORTE_ATTACHMENTS)
          .upload(path, buffer, { contentType: img.mime, upsert: false })

        if (!uploadError) {
          const { data: urlData } = supabaseAdmin.storage
            .from(STORAGE_BUCKETS.SOPORTE_ATTACHMENTS)
            .getPublicUrl(path)

          await supabaseAdmin
            .from("support_ticket_attachments")
            .insert({
              ticket_id: ticket.id,
              url: urlData.publicUrl,
              storage_path: path,
              mime: img.mime,
              nombre_archivo: fileName,
            })
        }
      }
    }

    return NextResponse.json({
      id: ticket.id,
      asunto: ticket.asunto,
      tipo: ticket.tipo,
      estado: ticket.estado,
    }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error creating ticket:", error)
    return NextResponse.json(
      { error: "Error al crear ticket" },
      { status: 500 }
    )
  }
}
