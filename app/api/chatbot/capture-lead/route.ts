import { NextResponse } from "next/server"
import { z } from "zod"
import { supabaseAdmin } from "@/lib/supabase"
import { upsertLeadFromConversation } from "@/lib/chatbot/upsert-lead"

const leadCaptureSchema = z.object({
  sessionId: z.string().min(1, "Session ID es requerido"),
  conversacionId: z.string().min(1, "Conversación ID es requerido"),
  nombre: z.string().optional(),
  email: z.string().email("Email inválido").optional(),
  telefono: z.string().optional(),
  empresa: z.string().optional(),
  interes: z.string().optional(),
  planInteres: z.string().optional(),
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const data = leadCaptureSchema.parse(body)

    if (!data.nombre && !data.email && !data.telefono && !data.empresa) {
      return NextResponse.json(
        { error: "Se requiere al menos uno: nombre, email, teléfono o empresa" },
        { status: 400 }
      )
    }

    let nombre = data.nombre

    if (!nombre) {
      const { data: mensajes } = await supabaseAdmin
        .from("chatbot_mensajes")
        .select("tipo, contenido")
        .eq("conversacion_id", data.conversacionId)
        .eq("tipo", "USER")
        .order("created_at", { ascending: true })
        .limit(20)

      if (mensajes) {
        const namePattern = /(?:me llamo|mi nombre es)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+){0,2})/i
        for (const msg of mensajes) {
          const match = msg.contenido.match(namePattern)
          if (match) {
            nombre = match[1].trim()
            break
          }
        }
      }

      if (!nombre && data.email) {
        const localPart = data.email.split("@")[0]
        const formatted = localPart
          .replace(/[._-]/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase())
        if (formatted.length >= 2) nombre = formatted
      }
    }

    const result = await upsertLeadFromConversation(data.conversacionId, data.sessionId, {
      nombre,
      email: data.email,
      telefono: data.telefono,
      empresa: data.empresa,
      interes: data.interes ?? "Consulta desde chatbot",
      planInteres: data.planInteres,
    })

    if (!result) {
      return NextResponse.json(
        { error: "No se pudo capturar el lead. Verificá la conversación." },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      leadId: result.leadId,
      message: result.created
        ? "Lead capturado exitosamente"
        : "Lead actualizado correctamente",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    console.error("Error capturando lead:", error)
    return NextResponse.json(
      { error: "Error al capturar lead. Por favor intentá de nuevo." },
      { status: 500 }
    )
  }
}
