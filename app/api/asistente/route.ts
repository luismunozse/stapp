import { NextResponse } from "next/server"
import { z } from "zod"
import Anthropic from "@anthropic-ai/sdk"
import { requireAuth, puedeVerDeudaClientes } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { canUseAsistente } from "@/lib/asistente/access"
import { checkAsistenteRateLimit } from "@/lib/asistente/rate-limit"
import { buildAsistenteSystemPrompt } from "@/lib/asistente/system-prompt"
import { ejecutarAsistente, ASISTENTE_MODEL, type EventoAsistente } from "@/lib/asistente/loop"
import { herramientasDisponibles, type ContextoHerramienta } from "@/lib/asistente/herramientas"
import { sugerenciasPara } from "@/lib/asistente/sugerencias"
import { actorDeSesion } from "@/lib/ordenes/alcance"
import { sucursalParaLectura } from "@/lib/sucursal"
import { todayInTimeZone, dayRangeUtc, DEFAULT_TIMEZONE } from "@/lib/timezone"

const DAILY_LIMIT_PER_ORG = 50
const HISTORY_TURNS = 6 // últimos 6 mensajes (3 idas y vueltas) van al modelo
const MENSAJES_RESTAURADOS = 30 // los que vuelve a mostrar el panel al recargar

const requestSchema = z.object({
  message: z.string().min(1, "El mensaje no puede estar vacío").max(1000, "El mensaje es demasiado largo"),
  conversacionId: z.string().nullable().optional(),
})

const anthropic = new Anthropic({ apiKey: process.env.STAPP_CHATBOT_API_KEY })

type Autenticado = Awaited<ReturnType<typeof requireAuth>>

const NO_DISPONIBLE = () =>
  NextResponse.json(
    { error: "El asistente está disponible en el plan Profesional.", code: "ASISTENTE_NOT_AVAILABLE" },
    { status: 403 }
  )

/** Zona horaria y moneda de la org, y cuántas consultas lleva hoy (día contado en su zona horaria). */
async function datosDeOrg(organizationId: string) {
  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("zona_horaria, moneda")
    .eq("id", organizationId)
    .single()
  const tz = org?.zona_horaria || DEFAULT_TIMEZONE
  const { desde, hasta } = dayRangeUtc(todayInTimeZone(tz), tz)
  const { count } = await supabaseAdmin
    .from("asistente_mensajes")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("tipo", "USER")
    .gte("created_at", desde)
    .lte("created_at", hasta)
  return { tz, moneda: org?.moneda || "ARS", usadosHoy: count ?? 0 }
}

async function contextoHerramientas(autenticado: Autenticado, tz: string, moneda: string): Promise<ContextoHerramienta> {
  const actor = actorDeSesion(autenticado)
  return {
    actor,
    moneda,
    zonaHoraria: tz,
    filtroLectura: await sucursalParaLectura({ role: actor.role, userSucursalId: actor.sucursalId }),
  }
}

/** La conversación si es de este usuario y org; null si no existe o es de otro. */
async function conversacionPropia(id: string, organizationId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from("asistente_conversaciones")
    .select("id")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .eq("usuario_id", userId)
    .single()
  return data ? (data.id as string) : null
}

/**
 * GET - Lo que el panel necesita al abrirse: sugerencias según los permisos del usuario, cuántas
 * consultas le quedan hoy a la org y, si pide una conversación suya, sus últimos mensajes.
 */
export async function GET(request: Request) {
  try {
    const autenticado = await requireAuth()
    const { error, organizationId, userId, role } = autenticado
    if (error) return error
    if (!(await canUseAsistente(organizationId!))) return NO_DISPONIBLE()

    const { tz, moneda, usadosHoy } = await datosDeOrg(organizationId!)
    const ctx = await contextoHerramientas(autenticado, tz, moneda)
    const [herramientas, verDeuda] = await Promise.all([
      herramientasDisponibles(ctx),
      puedeVerDeudaClientes(role, organizationId!),
    ])

    let conversacion: { id: string; mensajes: { id: string; tipo: string; contenido: string }[] } | null = null
    const pedida = new URL(request.url).searchParams.get("conversacionId")
    if (pedida) {
      const id = await conversacionPropia(pedida, organizationId!, userId!)
      if (id) {
        const { data } = await supabaseAdmin
          .from("asistente_mensajes")
          .select("id, tipo, contenido")
          .eq("conversacion_id", id)
          .order("created_at", { ascending: false })
          .limit(MENSAJES_RESTAURADOS)
        conversacion = { id, mensajes: (data ?? []).slice().reverse() }
      }
    }

    return NextResponse.json({
      sugerencias: sugerenciasPara(herramientas, verDeuda),
      restantes: Math.max(DAILY_LIMIT_PER_ORG - usadosHoy, 0),
      limiteDiario: DAILY_LIMIT_PER_ORG,
      conversacion,
    })
  } catch (err) {
    console.error("[Asistente] GET error:", err)
    return NextResponse.json({ error: "No se pudo cargar el asistente." }, { status: 500 })
  }
}

/**
 * POST - Un mensaje del usuario. Responde JSON `{ message, conversacionId, restantes }`, o con
 * `Accept: application/x-ndjson` una línea JSON por evento a medida que se arma la respuesta:
 * `conversacion`, `herramienta`, `texto` (delta), y al final `fin` (texto definitivo) o `error`.
 * Los errores previos a llamar al modelo (permiso, límites, validación) son siempre JSON con status.
 */
export async function POST(request: Request) {
  const startTime = Date.now()
  try {
    const autenticado = await requireAuth()
    const { error, organizationId, userId } = autenticado
    if (error) return error

    if (!(await canUseAsistente(organizationId!))) return NO_DISPONIBLE()

    if (!checkAsistenteRateLimit(userId!)) {
      return NextResponse.json(
        { error: "Demasiados mensajes seguidos. Esperá un minuto.", code: "RATE_LIMIT" },
        { status: 429 }
      )
    }

    const body = await request.json()
    const { message, conversacionId } = requestSchema.parse(body)

    // Tope diario por org, con "día" en la tz de la org (convención del proyecto)
    const { tz, moneda, usadosHoy } = await datosDeOrg(organizationId!)
    if (usadosHoy >= DAILY_LIMIT_PER_ORG) {
      return NextResponse.json(
        { error: "Alcanzaste el límite diario del asistente. Volvé mañana.", code: "DAILY_LIMIT", restantes: 0 },
        { status: 429 }
      )
    }

    // Conversación: reusar si pertenece a este usuario/org, crear si no
    let convId = conversacionId ? await conversacionPropia(conversacionId, organizationId!, userId!) : null
    if (!convId) {
      const { data: conv, error: convError } = await supabaseAdmin
        .from("asistente_conversaciones")
        .insert({ organization_id: organizationId!, usuario_id: userId! })
        .select("id")
        .single()
      if (convError || !conv) throw convError ?? new Error("No se pudo crear la conversación")
      convId = conv.id as string
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
    const ctx = await contextoHerramientas(autenticado, tz, moneda)
    const herramientas = await herramientasDisponibles(ctx)

    // La fecha va en el mensaje, nunca en el system prompt (rompería la caché).
    const mensajeConContexto = `[Hoy es ${todayInTimeZone(tz)}]\n\n${message}`
    // Esta consulta ya cuenta (se guarda solo si el modelo responde).
    const restantes = Math.max(DAILY_LIMIT_PER_ORG - usadosHoy - 1, 0)

    const responder = async (alEvento?: (e: EventoAsistente) => void) => {
      const resultado = await ejecutarAsistente({
        client: anthropic,
        system: buildAsistenteSystemPrompt(),
        historial: historialParams,
        mensaje: mensajeConContexto,
        herramientas,
        ctx,
        alEvento,
      })

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
        contenido: resultado.texto,
        modelo: ASISTENTE_MODEL,
        // Suma de todas las rondas del bucle de herramientas.
        input_tokens: resultado.uso.input_tokens,
        cache_read_input_tokens: resultado.uso.cache_read_input_tokens,
        cache_creation_input_tokens: resultado.uso.cache_creation_input_tokens,
        output_tokens: resultado.uso.output_tokens,
        herramientas: resultado.llamadas.length > 0 ? resultado.llamadas : null,
        tiempo_respuesta_ms: Date.now() - startTime,
      })

      return resultado.texto
    }

    const ERROR_UPSTREAM = "El asistente está teniendo problemas para responder. Probá de nuevo en unos segundos."

    if (request.headers.get("accept")?.includes("application/x-ndjson")) {
      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const enviar = (evento: Record<string, unknown>) => {
            // Si el usuario cerró el panel, la respuesta se guarda igual: solo dejamos de enviar.
            try {
              controller.enqueue(encoder.encode(JSON.stringify(evento) + "\n"))
            } catch {
              /* conexión cerrada */
            }
          }
          enviar({ tipo: "conversacion", conversacionId: convId })
          try {
            const texto = await responder((e) => enviar(e))
            enviar({ tipo: "fin", texto, conversacionId: convId, restantes })
          } catch (claudeError) {
            console.error("[Asistente] Claude API error:", claudeError)
            enviar({ tipo: "error", error: ERROR_UPSTREAM, code: "UPSTREAM_ERROR" })
          }
          try {
            controller.close()
          } catch {
            /* ya cerrada */
          }
        },
      })
      return new Response(stream, {
        headers: {
          "content-type": "application/x-ndjson; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          "x-accel-buffering": "no",
        },
      })
    }

    let assistantMessage: string
    try {
      assistantMessage = await responder()
    } catch (claudeError) {
      console.error("[Asistente] Claude API error:", claudeError)
      return NextResponse.json({ error: ERROR_UPSTREAM, code: "UPSTREAM_ERROR" }, { status: 502 })
    }

    return NextResponse.json({ message: assistantMessage, conversacionId: convId, restantes })
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
