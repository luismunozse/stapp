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
    let assistantMessage: string

    try {
      const result = await model.generateContent(fullPrompt)
      const response = result.response

      console.log("[Chatbot] Gemini response received:", {
        hasCandidates: !!response?.candidates,
        candidatesLength: response?.candidates?.length,
        hasText: !!response?.text,
      })

      if (!response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        console.error("[Chatbot] Gemini response blocked or empty:", {
          candidates: response?.candidates,
          promptFeedback: response?.promptFeedback,
        })
        throw new Error("Respuesta bloqueada o vacía")
      }

      assistantMessage = response.text()
    } catch (geminiError: any) {
      console.error("[Chatbot] Gemini API error:", geminiError?.message || geminiError)

      // Fallback response when API is unavailable or quota exceeded
      if (geminiError?.status === 429 || geminiError?.message?.includes("429")) {
        assistantMessage = "¡Hola! En este momento tenemos mucha demanda y no puedo responderte al instante. " +
          "Si querés, podés escribirnos a contacto@stapp.com.ar o visitá nuestra página para más info sobre STApp. " +
          "¡Gracias por tu paciencia!"
      } else {
        assistantMessage = "Disculpá, estoy teniendo algunos problemas técnicos. " +
          "Podés intentar de nuevo en unos segundos o escribirnos a contacto@stapp.com.ar. ¡Gracias!"
      }
    }

    console.log("[Chatbot] Assistant message:", assistantMessage?.substring(0, 100))

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

PLAN:
Un solo plan: Plan Premium, todo incluido.
- Primeros 30 días gratis, sin tarjeta de crédito requerida
- Argentina: $19.999 ARS/mes o $191.990/año (ahorro ~20% con plan anual)
- Otros países: USD $12/mes o USD $115/año
- Garantía de devolución de 30 días. Cancelás cuando quieras, sin penalidades.
- Pagos seguros con MercadoPago (Argentina) o tarjeta internacional (otros países)

Todo incluido en el plan:
- Órdenes ilimitadas
- Técnicos ilimitados
- Vendedores ilimitados
- Clientes ilimitados
- Punto de venta con garantías por producto
- Cotizaciones con aprobación online
- Portal de seguimiento para clientes (link público)
- Modo kiosco para mostrar estado de reparaciones en el local
- 15+ reportes avanzados
- Cuenta corriente de clientes
- Gestión de proveedores
- Importación y exportación de datos (Excel/CSV)
- 5GB de almacenamiento
- Notificaciones por WhatsApp
- Soporte prioritario
- Tu logo en presupuestos y órdenes

CARACTERÍSTICAS PRINCIPALES:

Servicio Técnico:
- Órdenes de Servicio: gestión de cada reparación de principio a fin con 10 estados (recibido, en diagnóstico, presupuestado, aprobado, en reparación, esperando repuesto, reparado, entregado, cancelado, sin reparación), checklists personalizados por tipo de dispositivo y seguimiento completo
- Cotizaciones y Presupuestos: sistema independiente de presupuestos con descuentos (fijos o porcentuales), impuestos configurables (IVA), condiciones y términos. El cliente los aprueba online con firma digital desde un link único, sin necesidad de crear cuenta. Exportación a PDF y envío por WhatsApp
- Fotos por Etapa: documentación visual de ingreso, durante la reparación y entrega. Protección ante reclamos con evidencia fotográfica almacenada en la nube
- Portal de Seguimiento: cada orden genera un link único que se comparte por WhatsApp. El cliente ve el estado en tiempo real, fotos, garantía y descarga el comprobante en PDF. No necesita cuenta ni instalar nada. El link expira automáticamente 30 días después de la entrega

Administración:
- Gestión de Clientes: historial completo y automático de reparaciones, pagos y cuenta corriente (crédito/débito). Soporte para clientes individuales y empresas con sectores. Búsqueda por nombre, teléfono o DNI. Importación masiva desde Excel/CSV
- Control de Inventario: alertas automáticas de stock bajo, historial de precios, control de costos y márgenes en tiempo real. Código automático, categorización por tipo de dispositivo. Importación masiva desde Excel/CSV con plantillas descargables
- Cobros y Facturación: desde la orden al cobro en un click. Pagos parciales, cuotas con recargo configurable, múltiples medios de pago (efectivo, transferencia, tarjeta de débito/crédito, MercadoPago, cuenta corriente). Facturación automática con numeración secuencial e IVA
- Sistema de Garantías: garantías vigentes, vencimientos con alertas automáticas (7 días antes), reclamos con estados (pendiente, en revisión, aceptado, rechazado, resuelto) y reingresos vinculados a la orden original. Trazabilidad completa

Ventas:
- Punto de Venta: módulo completo para vender accesorios y repuestos. Ventas con garantía por producto, múltiples medios de pago, gestión de devoluciones y numeración automática. Exportación a PDF
- Proveedores: gestión de proveedores con datos de contacto, WhatsApp, dirección, sitio web y notas. Estado activo/inactivo
- Equipo Comercial: técnicos, vendedores y administradores con roles diferenciados y permisos específicos. Métricas de rendimiento individuales por técnico y por vendedor
- Modo Kiosco: pantalla pública personalizable para mostrar el estado de las reparaciones en tu local. Columnas configurables, auto-refresh, filtros, tamaño de fuente y branding. Acceso por token sin login

Productividad:
- 15+ Reportes Avanzados: ingresos, ingresos unificados, comparativa de ingresos, analytics de clientes, analytics de ventas, analytics de inventario, fallas comunes, garantías vs ventas, rendimiento por técnico, tasa de retorno, tiempos de reparación, top clientes, rentabilidad, predicción de repuestos y resumen general. Exportación a CSV con filtros por fecha
- Notificaciones por WhatsApp: plantillas listas para enviar con un click. Aviso de equipo listo, presupuestos, seguimiento de reparación y entrega. Historial de notificaciones por cliente
- Firma Digital: captura de firma del cliente en la entrega y en la aprobación de presupuestos. Respaldo legal ante cualquier reclamo
- App Móvil + Offline: app nativa para Android (APK descargable), instalable como PWA en cualquier dispositivo (iPhone incluido), y modo offline con sincronización automática cuando volvés a tener conexión

SEGURIDAD:
- Encriptación HTTPS/TLS en todo momento
- Autenticación de dos factores (2FA) con códigos de respaldo para administradores
- Roles y permisos diferenciados (Admin, Técnico, Vendedor)
- Row-Level Security (aislamiento completo de datos por organización)
- Backups automáticos periódicos
- Auditoría completa de acciones (quién hizo qué y cuándo)

VENTAJAS COMPETITIVAS vs Excel/Papel:
- No necesita instalación, funciona 100% en el navegador
- Accesible desde cualquier dispositivo (PC, tablet, celular) incluso sin conexión
- Tu cliente puede seguir su reparación online (nadie más ofrece esto gratis)
- Aprobación de presupuestos online con firma digital
- Pantalla kiosco en tu local para que el cliente vea el estado sin preguntar
- Multi-usuario con roles y permisos
- Actualizaciones automáticas sin costo adicional
- Soporte en español con asistente virtual y sistema de tickets

CASOS DE USO TÍPICOS:
- Service de celulares
- Reparación de computadoras y notebooks
- Talleres de electrónica
- Service de tablets, consolas y smartwatches
- Tiendas de reparación que también venden accesorios y repuestos
- Talleres con múltiples técnicos y sucursales

CONTACTO:
- WhatsApp: +54 9 11 6962-5733
- Web: https://stapp.com.ar
- Email: contacto@stapp.com.ar

Si detectás interés genuino (solicitud de demo, preguntas detalladas sobre precios, preguntar cómo empezar, pedir más info), preguntá amablemente y de forma natural por:
1. Primero el nombre
2. Luego email o teléfono
3. Opcionalmente nombre del taller

Nunca pidas todos los datos de golpe. Hacelo natural en la conversación, como lo haría un vendedor humano.
Si el usuario quiere hablar con una persona, indicale que puede escribirnos por WhatsApp al +54 9 11 6962-5733.`
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
