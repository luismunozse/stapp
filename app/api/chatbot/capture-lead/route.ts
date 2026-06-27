import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { z } from "zod"
import { supabaseAdmin } from "@/lib/supabase"
import { upsertLeadFromConversation } from "@/lib/chatbot/upsert-lead"

const leadCaptureSchema = z.object({
  sessionId: z.string().min(1, "Session ID es requerido"),
  conversacionId: z.string().optional(),
  nombre: z.string().optional(),
  email: z.string().email("Email inválido").optional(),
  telefono: z.string().optional(),
  empresa: z.string().optional(),
  interes: z.string().optional(),
  planInteres: z.string().optional(),
  fuente: z.enum(["form"]).optional(),
})

async function resolveConversacionId(
  sessionId: string,
  conversacionId: string | undefined
): Promise<string | null> {
  if (conversacionId) {
    const { data } = await supabaseAdmin
      .from("chatbot_conversaciones")
      .select("id, session_id")
      .eq("id", conversacionId)
      .eq("session_id", sessionId)
      .maybeSingle()
    if (data) return data.id as string
  }

  const headersList = await headers()
  const ip = headersList.get("x-forwarded-for") || headersList.get("x-real-ip") || "unknown"
  const userAgent = headersList.get("user-agent") || "unknown"
  const referrer = headersList.get("referer") || headersList.get("referrer") || null

  const { data, error } = await supabaseAdmin
    .from("chatbot_conversaciones")
    .insert({ session_id: sessionId, ip_address: ip, user_agent: userAgent, referrer })
    .select("id, session_id")
    .single()
  if (error || !data) return null
  return data.id as string
}

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

    const conversacionId = await resolveConversacionId(data.sessionId, data.conversacionId)
    if (!conversacionId) {
      return NextResponse.json(
        { error: "No se pudo iniciar la conversación. Intentá de nuevo." },
        { status: 500 }
      )
    }

    let nombre = data.nombre
    if (!nombre && data.email) {
      const localPart = data.email.split("@")[0]
      const formatted = localPart.replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      if (formatted.length >= 2) nombre = formatted
    }

    const esForm = data.fuente === "form"
    const result = await upsertLeadFromConversation(conversacionId, data.sessionId, {
      nombre,
      email: data.email,
      telefono: data.telefono,
      empresa: data.empresa,
      interes: data.interes ?? (esForm ? "Pidió ser contactado (chatbot)" : "Consulta desde chatbot"),
      planInteres: data.planInteres,
      score: esForm ? 85 : null,
    })

    if (!result) {
      return NextResponse.json(
        { error: "No se pudo capturar el lead. Verificá los datos." },
        { status: 422 }
      )
    }

    return NextResponse.json({
      success: true,
      leadId: result.leadId,
      message: result.created ? "Lead capturado exitosamente" : "Lead actualizado correctamente",
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
