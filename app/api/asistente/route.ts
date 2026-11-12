import { NextResponse } from "next/server"
import { z } from "zod"
import Anthropic from "@anthropic-ai/sdk"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { canUseAsistente } from "@/lib/asistente/access"
import { checkAsistenteRateLimit } from "@/lib/asistente/rate-limit"
import { buildAsistenteSystemPrompt } from "@/lib/asistente/system-prompt"
import { ejecutarAsistente, ASISTENTE_MODEL } from "@/lib/asistente/loop"
import { herramientasDisponibles } from "@/lib/asistente/herramientas"
import { actorDeSesion } from "@/lib/ordenes/alcance"
import { todayInTimeZone, dayRangeUtc, DEFAULT_TIMEZONE } from "@/lib/timezone"

const DAILY_LIMIT_PER_ORG = 50
const HISTORY_TURNS = 6 // últimos 6 mensajes (3 idas y vueltas)

const requestSchema = z.object({
  message: z.string().min(1, "El mensaje no puede estar vacío").max(1000, "El mensaje es demasiado largo"),
  conversacionId: z.string().nullable().optional(),
})

const anthropic = new Anthropic({ apiKey: process.env.STAPP_CHATBOT_API_KEY })

export async function POST(request: Request) {
  const startTime = Date.now()
  try {
    const autenticado = await requireAuth()
    const { error, organizationId, userId } = autenticado
    if (error) return error

    if (!(await canUseAsistente(organizationId!))) {
      return NextResponse.json(
        { error: "El asistente está disponible en el plan Profesional.", code: "ASISTENTE_NOT_AVAILABLE" },
        { status: 403 }
      )
    }

    if (!checkAsistenteRateLimit(userId!)) {
      return NextResponse.json(
        { error: "Demasiados mensajes seguidos. Esperá un minuto.", code: "RATE_LIMIT" },
        { status: 429 }
      )
    }

    const body = await request.json()
    const { message, conversacionId } = requestSchema.parse(body)

    // Tope diario por org, con "día" en la tz de la org (convención del proyecto)
    const { data: orgTz } = await supabaseAdmin
      .from("organizations")
      .select("zona_horaria, moneda")
      .eq("id", organizationId!)
      .single()
    const tz = orgTz?.zona_horaria || DEFAULT_TIMEZONE
    const { desde, hasta } = dayRangeUtc(todayInTimeZone(tz), tz)

    const { count: usedToday } = await supabaseAdmin
      .from("asistente_mensajes")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId!)
      .eq("tipo", "USER")
      .gte("created_at", desde)
      .lte("created_at", hasta)

    if ((usedToday ?? 0) >= DAILY_LIMIT_PER_ORG) {
      return NextResponse.json(
        { error: "Alcanzaste el límite diario del asistente. Volvé mañana.", code: "DAILY_LIMIT" },
        { status: 429 }
      )
    }

    // Conversación: reusar si pertenece a este usuario/org, crear si no
    let convId = conversacionId ?? null
    if (convId) {
      const { data: conv } = await supabaseAdmin
        .from("asistente_conversaciones")
        .select("id")
        .eq("id", convId)
        .eq("organization_id", organizationId!)
        .eq("usuario_id", userId!)
        .single()
      if (!conv) convId = null
    }
    if (!convId) {
      const { data: conv, error: convError } = await supabaseAdmin
        .from("asistente_conversaciones")
        .insert({ organization_id: organizationId!, usuario_id: userId! })
        .select("id")
        .single()
      if (convError || !conv) throw convError ?? new Error("No se pudo crear la conversación")
      convId = conv.id
    }

    // Historial: últimos N mensajes en orden cronológico
    const { data: historial } = await supabaseAdmin
      .from("asistente_mensajes")
      .select("tipo, contenido")
      .eq("conversacion_id", convId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_TURNS)
    const ordered = (historial ?? []).slice().reverse()

    // Multi-turn real (no concatenación en un string): preserva la caché
    // del system prompt entre turnos. El historial guarda solo texto: los
    // resultados de herramientas no se arrastran, se vuelven a consultar.
    const historialParams: Anthropic.MessageParam[] = ordered.map((m) => ({
      role: (m.tipo === "USER" ? "user" : "assistant") as "user" | "assistant",
      content: m.contenido,
    }))

    // Herramientas de solo lectura con los permisos del usuario (sin permiso, ni se ofrecen).
    const ctx = { actor: actorDeSesion(autenticado), moneda: orgTz?.moneda || "ARS" }
    const herramientas = await herramientasDisponibles(ctx)

    // La fecha va en el mensaje, nunca en el system prompt (rompería la caché).
    const mensajeConContexto = `[Hoy es ${todayInTimeZone(tz)}]\n\n${message}`

    let resultado: Awaited<ReturnType<typeof ejecutarAsistente>>
    try {
      resultado = await ejecutarAsistente({
        client: anthropic,
        system: buildAsistenteSystemPrompt(),
        historial: historialParams,
        mensaje: mensajeConContexto,
        herramientas,
        ctx,
      })
    } catch (claudeError) {
      console.error("[Asistente] Claude API error:", claudeError)
      return NextResponse.json(
        {
          error: "El asistente está teniendo problemas para responder. Probá de nuevo en unos segundos.",
          code: "UPSTREAM_ERROR",
        },
        { status: 502 }
      )
    }

    const assistantMessage = resultado.texto

    await supabaseAdmin.from("asistente_mensajes").insert({
      conversacion_id: convId,
      organization_id: organizationId!,
      tipo: "USER",
      contenido: message,
    })

    await supabaseAdmin.from("asistente_mensajes").insert({
      conversacion_id: convId,
      organization_id: organizationId!,
      tipo: "ASSISTANT",
      contenido: assistantMessage,
      modelo: ASISTENTE_MODEL,
      // Suma de todas las rondas del bucle de herramientas.
      input_tokens: resultado.uso.input_tokens,
      cache_read_input_tokens: resultado.uso.cache_read_input_tokens,
      cache_creation_input_tokens: resultado.uso.cache_creation_input_tokens,
      output_tokens: resultado.uso.output_tokens,
      herramientas: resultado.llamadas.length > 0 ? resultado.llamadas : null,
      tiempo_respuesta_ms: Date.now() - startTime,
    })

    return NextResponse.json({ message: assistantMessage, conversacionId: convId })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0].message }, { status: 400 })
    }
    console.error("[Asistente] error:", err)
    return NextResponse.json(
      { error: "Error al procesar el mensaje. Probá de nuevo." },
      { status: 500 }
    )
  }
}
