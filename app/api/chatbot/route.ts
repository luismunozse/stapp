import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai"
import { headers } from "next/headers"

// NO usar requireAuth() - este endpoint es público
// Usando gemini-2.0-flash

const chatRequestSchema = z.object({
  sessionId: z.string().min(1, "Session ID es requerido"),
  message: z.string().min(1, "El mensaje no puede estar vacío").max(2000, "El mensaje es demasiado largo"),
  conversacionId: z.string().nullable().optional(),
})

// Inicializar Gemini
if (!process.env.GOOGLE_GEMINI_API_KEY) {
  console.error("[Chatbot] GOOGLE_GEMINI_API_KEY no está configurada en .env")
}
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY || "")

// Rate limiting simple en memoria (en producción usar Redis)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>()

function checkRateLimit(identifier: string): boolean {
  const now = Date.now()
  const limit = rateLimitMap.get(identifier)

  if (!limit || now > limit.resetTime) {
    rateLimitMap.set(identifier, { count: 1, resetTime: now + 60000 }) // 1 minuto
    return true
  }

  if (limit.count >= 20) {
    // 20 mensajes por minuto
    return false
  }

  limit.count++
  return true
}

export async function POST(request: Request) {
  const startTime = Date.now()

  try {
    const body = await request.json()
    const { sessionId, message, conversacionId } = chatRequestSchema.parse(body)

    // Rate limiting por sessionId
    if (!checkRateLimit(sessionId)) {
      return NextResponse.json(
        { error: "Demasiados mensajes. Esperá un momento." },
        { status: 429 }
      )
    }

    // Obtener metadata de la request
    const headersList = await headers()
    const ip = headersList.get("x-forwarded-for") || headersList.get("x-real-ip") || "unknown"
    const userAgent = headersList.get("user-agent") || "unknown"
    const referrer = headersList.get("referer") || headersList.get("referrer") || null

    // Obtener o crear conversación
    let conversacion: any
    if (conversacionId) {
      const { data } = await supabaseAdmin
        .from("chatbot_conversaciones")
        .select("*")
        .eq("id", conversacionId)
        .eq("session_id", sessionId)
        .single()
      conversacion = data
    }

    if (!conversacion) {
      const { data, error } = await supabaseAdmin
        .from("chatbot_conversaciones")
        .insert({
          session_id: sessionId,
          ip_address: ip,
          user_agent: userAgent,
          referrer: referrer,
        })
        .select()
        .single()

      if (error) throw error
      conversacion = data
    }

    // Guardar mensaje del usuario
    await supabaseAdmin.from("chatbot_mensajes").insert({
      conversacion_id: conversacion.id,
      tipo: "USER",
      contenido: message,
    })

    // Obtener historial de la conversación (últimos 10 mensajes para contexto)
    const { data: historial } = await supabaseAdmin
      .from("chatbot_mensajes")
      .select("tipo, contenido")
      .eq("conversacion_id", conversacion.id)
      .order("created_at", { ascending: false })
      .limit(10)

    // Construir contexto para Gemini
    const contextPrompt = buildContextPrompt()
    const conversationHistory =
      historial
        ?.reverse()
        .map((m) => `${m.tipo === "USER" ? "Usuario" : "Santi"}: ${m.contenido}`)
        .join("\n") || ""

    // Llamar a Gemini con configuración de seguridad más permisiva
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
      ],
    })

    const fullPrompt = `${contextPrompt}

${conversationHistory ? `Historial de la conversación:\n${conversationHistory}\n` : ""}
Usuario: ${message}

Instrucciones:
- Respondé como Santi de forma natural, útil y concisa (máximo 3 párrafos)
- Si el usuario muestra interés genuino en el producto (pregunta por demo, precios, cómo empezar), preguntale de forma natural por su nombre, email o teléfono para darle más información personalizada
- No pidas todos los datos de golpe, hacelo gradualmente durante la conversación
- Usá español argentino informal pero profesional (vos, "querés", "tenés", etc.)
- Si ya tenés suficiente información del usuario, agradecer y confirmar que alguien lo contactará pronto`

    console.log("[Chatbot] Sending prompt to Gemini...")
    const result = await model.generateContent(fullPrompt)
    const response = result.response

    console.log("[Chatbot] Gemini response received:", {
      hasCandidates: !!response?.candidates,
      candidatesLength: response?.candidates?.length,
      hasText: !!response?.text,
    })

    // Verificar si la respuesta fue bloqueada por safety
    if (!response?.candidates?.[0]?.content?.parts?.[0]?.text) {
      console.error("[Chatbot] Gemini response blocked or empty:", {
        candidates: response?.candidates,
        promptFeedback: response?.promptFeedback,
      })
      throw new Error("La respuesta fue bloqueada por el filtro de seguridad de Gemini o está vacía")
    }

    const assistantMessage = response.text()
    console.log("[Chatbot] Assistant message extracted:", assistantMessage?.substring(0, 100))

    const timeElapsed = Date.now() - startTime

    // Detectar intención
    const intencion = detectIntention(message, assistantMessage)

    // Guardar respuesta del asistente
    await supabaseAdmin.from("chatbot_mensajes").insert({
      conversacion_id: conversacion.id,
      tipo: "ASSISTANT",
      contenido: assistantMessage,
      modelo: "gemini-2.0-flash",
      tiempo_respuesta_ms: timeElapsed,
      intencion_detectada: intencion.tipo,
      confianza: intencion.confianza,
    })

    return NextResponse.json({
      message: assistantMessage,
      conversacionId: conversacion.id,
      sessionId: sessionId,
      intencion: intencion.tipo,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    console.error("Error en chatbot:", error)
    return NextResponse.json({ error: "Error al procesar el mensaje. Por favor intentá de nuevo." }, { status: 500 })
  }
}

function buildContextPrompt(): string {
  return `Sos Santi, el asistente virtual de STApp, un software para gestión de talleres de reparación de dispositivos electrónicos.

Tu personalidad:
- Sos amigable, profesional y servicial
- Hablás en español argentino de forma natural (usá vos, "querés", "tenés", "podés", etc.)
- Sos conciso pero completo en tus respuestas
- Te enfocás en ayudar y resolver dudas
- Nunca inventás información que no tenés

Información sobre STApp:

PLANES:
1. Plan Free (Gratis para siempre):
   - 50 órdenes por mes
   - 2 técnicos
   - 100 clientes
   - Reportes básicos
   - 100MB de almacenamiento
   - Ideal para empezar o talleres pequeños

2. Plan Premium ($14.999/mes o $143.990/año con 20% de descuento):
   - Órdenes ilimitadas
   - Técnicos ilimitados
   - Clientes ilimitados
   - Reportes avanzados con gráficos
   - 5GB de almacenamiento
   - Notificaciones automáticas por WhatsApp y Email
   - Logo personalizado en documentos
   - Soporte prioritario
   - Gestión de inventario completa
   - Sistema de facturación integrado
   - Módulo de ventas con garantías

CARACTERÍSTICAS PRINCIPALES:
- Órdenes de servicio con seguimiento completo del estado
- Control de inventario de repuestos y stock
- Facturación integrada con pagos parciales
- Gestión completa de clientes con historial
- Asignación de técnicos a las reparaciones
- Reportes y estadísticas en tiempo real
- Notificaciones automáticas a clientes por WhatsApp/Email
- App móvil (PWA) instalable en cualquier dispositivo
- Checklist personalizable por tipo de dispositivo
- Generación de PDFs profesionales
- Sistema de garantías para reparaciones

VENTAJAS:
- No necesita instalación, funciona 100% en el navegador
- Accesible desde cualquier dispositivo (PC, tablet, celular)
- Datos seguros con encriptación de nivel bancario
- Backups automáticos diarios de toda la información
- Soporte en español
- Interfaz intuitiva y fácil de usar
- Actualizaciones automáticas sin costo adicional
- Multi-usuario con roles (Admin, Técnico, Vendedor)

CASOS DE USO TÍPICOS:
- Service de celulares
- Reparación de computadoras
- Talleres de electrónica
- Service de tablets y consolas
- Tiendas de reparación multi-marca

Si detectás interés genuino (solicitud de demo, preguntas detalladas sobre precios, preguntar cómo empezar, pedir más info), preguntá amablemente y de forma natural por:
1. Primero el nombre
2. Luego email o teléfono
3. Opcionalmente nombre del taller

Nunca pidas todos los datos de golpe. Hacelo natural en la conversación, como lo haría un vendedor humano.`
}

function detectIntention(userMessage: string, assistantResponse: string): { tipo: string; confianza: number } {
  const msg = userMessage.toLowerCase()

  // Solicitud de demo
  if (msg.includes("demo") || msg.includes("probar") || msg.includes("prueba") || msg.includes("testear")) {
    return { tipo: "solicitar_demo", confianza: 0.9 }
  }

  // Preguntas sobre precios
  if (
    msg.includes("precio") ||
    msg.includes("costo") ||
    msg.includes("cuanto") ||
    msg.includes("cuánto") ||
    msg.includes("vale")
  ) {
    return { tipo: "preguntar_precio", confianza: 0.85 }
  }

  // Comparación de planes
  if (
    msg.includes("diferencia") ||
    msg.includes("plan") ||
    msg.includes("premium") ||
    msg.includes("free") ||
    msg.includes("gratis")
  ) {
    return { tipo: "comparar_planes", confianza: 0.8 }
  }

  // Preguntar cómo empezar
  if (
    msg.includes("empezar") ||
    msg.includes("comenzar") ||
    msg.includes("registr") ||
    msg.includes("crear cuenta") ||
    msg.includes("sign up")
  ) {
    return { tipo: "como_empezar", confianza: 0.85 }
  }

  // Información de contacto proporcionada
  if (
    msg.includes("@") ||
    /\d{3,}/.test(msg) ||
    msg.includes("me llamo") ||
    msg.includes("mi nombre") ||
    msg.includes("soy ") ||
    msg.includes("llamame")
  ) {
    return { tipo: "proporcionar_contacto", confianza: 0.95 }
  }

  // Pregunta sobre funcionalidades
  if (
    msg.includes("funciona") ||
    msg.includes("característica") ||
    msg.includes("puede") ||
    msg.includes("permite") ||
    msg.includes("tiene")
  ) {
    return { tipo: "pregunta_funcionalidad", confianza: 0.75 }
  }

  // Saludo inicial
  if (msg.includes("hola") || msg.includes("buenas") || msg.includes("buenos días") || msg.includes("buenas tardes")) {
    return { tipo: "saludo", confianza: 0.9 }
  }

  // Pregunta general
  return { tipo: "pregunta_general", confianza: 0.7 }
}
