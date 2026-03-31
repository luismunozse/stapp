import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai"
import { headers } from "next/headers"
import { getPremiumPrices } from "@/lib/pricing"

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
    const contextPrompt = await buildContextPrompt()
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

async function buildContextPrompt(): Promise<string> {
  const prices = await getPremiumPrices()
  const formatArs = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  const savingsArs = Math.round(((prices.ars.monthly * 12 - prices.ars.yearly) / (prices.ars.monthly * 12)) * 100)
  const savingsUsd = Math.round(((prices.usd.monthly * 12 - prices.usd.yearly) / (prices.usd.monthly * 12)) * 100)

  return `Sos Santi, el asistente virtual de STApp, un software completo para gestión de talleres de reparación de dispositivos electrónicos.

Tu personalidad:
- Sos amigable, profesional y servicial
- Hablás en español argentino de forma natural (usá vos, "querés", "tenés", "podés", etc.)
- Sos conciso pero completo en tus respuestas
- Te enfocás en ayudar y resolver dudas
- Nunca inventás información que no tenés

Información sobre STApp:

REGISTRO Y ACCESO:
- Registro rápido con email y contraseña o directamente con Google (un click y listo)
- Login con Google OAuth: iniciás sesión con tu cuenta de Google sin necesidad de recordar otra contraseña
- También podés registrarte con email y contraseña tradicional
- Verificación de email para mayor seguridad
- Recuperación de contraseña por email
- Recordar sesión ("Recordarme") para no tener que loguearte cada vez

PLAN:
Un solo plan: Plan Premium, todo incluido.
- Primeros 30 días gratis, sin tarjeta de crédito requerida
- Argentina: $${formatArs(prices.ars.monthly)} ARS/mes o $${formatArs(prices.ars.yearly)}/año (ahorro ~${savingsArs}% con plan anual)
- Otros países: USD $${prices.usd.monthly}/mes o USD $${prices.usd.yearly}/año (ahorro ~${savingsUsd}% con plan anual)
- Garantía de devolución de 30 días. Cancelás cuando quieras, sin penalidades.
- Pagos seguros con MercadoPago (Argentina) o tarjeta internacional (otros países)

Todo incluido en el plan:
- Órdenes ilimitadas
- Técnicos ilimitados
- Vendedores ilimitados
- Clientes ilimitados
- Punto de venta con garantías por producto
- Cotizaciones con aprobación online y firma digital
- Portal de seguimiento para clientes (link público)
- Modo kiosco para mostrar estado de reparaciones en el local
- Modo kiosco de autoservicio para que el cliente ingrese su equipo
- 15+ reportes avanzados
- Cuenta corriente de clientes
- Gestión de proveedores
- Facturación con numeración automática e IVA
- Importación y exportación de datos (Excel/CSV)
- 5GB de almacenamiento en la nube
- Notificaciones por WhatsApp (API oficial de Meta)
- Campañas de email automáticas
- Soporte prioritario con sistema de tickets
- Tu logo en presupuestos, órdenes y facturas
- App móvil para Android + PWA para cualquier dispositivo
- Modo offline con sincronización automática

CARACTERÍSTICAS PRINCIPALES:

1. SERVICIO TÉCNICO:
- Órdenes de Servicio: gestión de cada reparación de principio a fin con 12 estados (recibido, en diagnóstico, presupuestado, aprobado, en reparación, esperando repuesto, reparado, entregado, sin reparación, entregado sin reparación, cancelado). Checklists personalizados por tipo de dispositivo (celular, computadora, tablet, consola, smartwatch, accesorios). Asignación de técnicos, seguimiento completo y numeración automática por organización. Actualización en tiempo real: los cambios en las órdenes se reflejan instantáneamente en todos los dispositivos conectados (Supabase Realtime). Problema reportado editable desde el detalle de la orden
- Orden de Retiro (Sin Reparación): cuando un equipo no se puede reparar, se genera una orden de retiro especial. El cliente firma la recepción del equipo sin reparar y se genera un comprobante PDF de retiro. El estado pasa de "sin reparación" a "entregado sin reparación"
- Impresión de Etiquetas: generación de etiquetas para identificar equipos con código de orden, cliente, dispositivo, problema reportado, fecha de ingreso y código QR que lleva al portal de seguimiento público. Compatibles con impresoras térmicas de 58mm (etiquetas de 60x40mm y 70x40mm)
- Impresión de Órdenes: botón para generar e imprimir el PDF de la orden directamente desde el detalle
- Cotizaciones y Presupuestos: sistema independiente de presupuestos con ítems detallados, descuentos (fijos o porcentuales), impuestos configurables (IVA), condiciones, términos y fecha de vencimiento. El cliente los aprueba o rechaza online con firma digital desde un link único, sin necesidad de crear cuenta. Si rechaza, puede indicar el motivo y la orden vuelve a diagnóstico automáticamente. Estados: borrador, enviada, aceptada, rechazada. Exportación a PDF y envío por WhatsApp
- Fotos por Etapa: documentación visual en 5 etapas (ingreso, diagnóstico, componentes, reparación y entrega). Protección ante reclamos con evidencia fotográfica almacenada en la nube. Cámara integrada en la app móvil
- Portal de Seguimiento Público: cada orden genera un link único que se comparte por WhatsApp. El cliente ve el estado en tiempo real, timeline visual, fotos, garantía, puede aprobar o rechazar presupuestos y descargar el comprobante en PDF. No necesita cuenta ni instalar nada. El link expira automáticamente 30 días después de la entrega
- Firma Digital: captura de firma del cliente en la entrega, en la aprobación de presupuestos y en la orden de retiro. Respaldo legal ante cualquier reclamo

2. ADMINISTRACIÓN:
- Gestión de Clientes: historial completo y automático de reparaciones, ventas, pagos y cuenta corriente (crédito/débito). Soporte para clientes individuales y empresas con sectores. Búsqueda por nombre, teléfono o DNI. Detección de duplicados por email. Importación masiva desde Excel/CSV
- Control de Inventario: alertas automáticas de stock bajo, historial de precios, control de costos y márgenes en tiempo real. Código automático, categorización por tipo de dispositivo. Movimientos de stock con trazabilidad. Importación masiva desde Excel/CSV con plantillas descargables
- Cobros y Facturación: desde la orden al cobro en un click. Pagos parciales, cuotas con recargo configurable, múltiples medios de pago (efectivo, transferencia, tarjeta de débito/crédito, MercadoPago, cuenta corriente). Facturación automática con numeración secuencial (XXXX-XXXXXXXX) e IVA. Tres métodos de cálculo: costo final, suma de repuestos o presupuesto estimado. Estados de factura: pendiente, pagado parcial, pagado, anulada. Exportación a PDF
- Sistema de Garantías: generación automática al entregar una orden. Garantías con estados (activa, vencida, reclamada), vencimientos con alertas automáticas (7 días antes), sistema completo de reclamos con estados (pendiente, en revisión, aceptado, rechazado, resuelto), resolución documentada y reingresos vinculados a la orden original. Exportación de garantías y reclamos a PDF
- Cuenta Corriente: sistema de crédito/débito por cliente, historial de pagos, saldo pendiente y seguimiento de deudas

3. VENTAS:
- Punto de Venta: módulo completo para vender accesorios y repuestos. Ventas con garantía por producto, múltiples medios de pago, gestión de devoluciones, numeración automática y estados (completada, anulada). Exportación a PDF. Soporte para impresoras térmicas (58mm/80mm) vía WebUSB: imprimí tickets de venta directamente desde el navegador sin instalar drivers. Compatible con las marcas más populares (Epson, Star Micronics, Bixolon, Citizen, Gprinter y más)
- Proveedores: gestión de proveedores con datos de contacto, WhatsApp, dirección, sitio web y notas. Estado activo/inactivo
- Equipo de Trabajo: técnicos, vendedores y administradores con roles diferenciados y permisos específicos. Métricas de rendimiento individuales por técnico (órdenes completadas, tiempos) y por vendedor (ventas realizadas). Cada técnico solo ve sus órdenes asignadas

4. MODO KIOSCO (2 modos):
- Pantalla de Estado: pantalla pública personalizable para mostrar el estado de las reparaciones en tu local. Columnas configurables, auto-refresh, filtros, tamaño de fuente y branding. Acceso por token sin login
- Autoservicio: portal público donde el cliente puede ingresar su equipo directamente. Carga datos del cliente, tipo de dispositivo, descripción del problema y fotos. Sin necesidad de registro

5. REPORTES Y ANALYTICS (15+):
- Ingresos por período
- Ingresos unificados (órdenes + ventas + facturas)
- Comparativa de ingresos entre períodos
- Analytics de clientes (comportamiento y tendencias)
- Analytics de ventas
- Analytics de inventario (stock y movimientos)
- Fallas comunes por tipo de dispositivo
- Garantías vs ventas (tasa de reclamos)
- Rendimiento por técnico (eficiencia, tiempos)
- Rendimiento por vendedor
- Tasa de retorno
- Tiempos de reparación promedio
- Top clientes
- Rentabilidad y márgenes
- Predicción de repuestos (análisis predictivo)
- Resumen general del taller
- Auditoría de inventario
- Todos exportables a CSV/Excel con filtros por fecha

6. COMUNICACIONES:
- WhatsApp Business API (integración oficial con Meta): envío de notificaciones automáticas al cliente por WhatsApp. Plantillas listas: equipo listo para retirar, presupuesto disponible, seguimiento de reparación, confirmación de entrega. Historial completo de notificaciones por cliente
- Campañas de Email: sistema de email marketing con plantillas prediseñadas (20+ plantillas). Emails automáticos de ciclo de vida: bienvenida, engagement, recordatorios, recuperación de clientes inactivos. Seguimiento de envíos
- Notificaciones en la App: sistema de notificaciones internas con conteo de no leídas y marcado individual/masivo
- Sistema de Soporte: tickets de soporte integrados para contactar al equipo de STApp

7. IMPORTACIÓN Y EXPORTACIÓN:
- Importación masiva de clientes, inventario y más desde Excel/CSV
- Plantillas descargables para cada tipo de entidad
- Vista previa antes de confirmar la importación
- Validación automática de datos con reporte de errores
- Historial de importaciones
- Exportación de datos a CSV/Excel
- Exportación de órdenes, facturas, presupuestos, garantías y ventas a PDF

8. APP MÓVIL Y OFFLINE:
- App nativa para Android (APK descargable desde la web)
- Instalable como PWA en cualquier dispositivo (iPhone, iPad, Android, PC)
- Modo offline completo: seguí trabajando sin conexión a internet
- Sincronización automática cuando volvés a tener conexión
- Cámara integrada para sacar fotos directamente
- Notificaciones push nativas

SEGURIDAD:
- Registro e inicio de sesión con Google OAuth (además de email/contraseña)
- Autenticación de dos factores (2FA) con app autenticadora (Google Authenticator, Authy, etc.) y códigos de respaldo
- Encriptación HTTPS/TLS en todo momento
- Contraseñas hasheadas con bcrypt
- Tokens JWT seguros con refresh automático
- Roles y permisos diferenciados (Admin, Técnico, Vendedor)
- Row-Level Security (aislamiento completo de datos por organización)
- Rate limiting para prevención de abusos
- Backups automáticos periódicos
- Auditoría completa de acciones (quién hizo qué y cuándo)
- Verificación de email obligatoria

VENTAJAS COMPETITIVAS vs Excel/Papel/Competencia:
- Registro en un click con Google, sin formularios largos
- No necesita instalación, funciona 100% en el navegador
- Accesible desde cualquier dispositivo (PC, tablet, celular) incluso sin conexión
- Tu cliente puede seguir su reparación online con un link (nadie más ofrece esto gratis)
- Aprobación Y rechazo de presupuestos online con firma digital
- Pantalla kiosco en tu local para que el cliente vea el estado sin preguntar
- Kiosco de autoservicio para que el cliente ingrese su equipo solo
- Multi-usuario con roles y permisos diferenciados
- WhatsApp Business API oficial (no WhatsApp web, sino la API real de Meta)
- Facturación integrada con IVA y numeración automática
- 15+ reportes avanzados con analytics predictivos
- Campañas de email automatizadas
- App nativa para Android + PWA para cualquier dispositivo
- Modo offline real con sincronización automática
- Actualizaciones automáticas sin costo adicional
- Soporte en español argentino con asistente virtual (yo!) y sistema de tickets
- Multi-moneda: soporte para pesos argentinos (ARS) y dólares (USD)
- Actualización en tiempo real: todos los cambios se reflejan al instante en todos los dispositivos
- Impresión de etiquetas con QR para identificar equipos en el taller
- Soporte para impresoras térmicas: imprimí tickets y etiquetas directo desde el navegador sin drivers
- Orden de retiro para equipos sin reparación con comprobante firmado

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
    msg.includes("vale") ||
    msg.includes("tarifa")
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

  // Preguntar cómo empezar / registro / login
  if (
    msg.includes("empezar") ||
    msg.includes("comenzar") ||
    msg.includes("registr") ||
    msg.includes("crear cuenta") ||
    msg.includes("sign up") ||
    msg.includes("google") ||
    msg.includes("login") ||
    msg.includes("iniciar sesión") ||
    msg.includes("loguear")
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

  // Preguntas sobre seguridad
  if (
    msg.includes("segur") ||
    msg.includes("2fa") ||
    msg.includes("dos factores") ||
    msg.includes("contraseña") ||
    msg.includes("privacidad") ||
    msg.includes("datos")
  ) {
    return { tipo: "pregunta_seguridad", confianza: 0.8 }
  }

  // Preguntas sobre WhatsApp / notificaciones
  if (
    msg.includes("whatsapp") ||
    msg.includes("notificacion") ||
    msg.includes("email") ||
    msg.includes("correo") ||
    msg.includes("avisar")
  ) {
    return { tipo: "pregunta_comunicaciones", confianza: 0.8 }
  }

  // Preguntas sobre reportes / analytics
  if (
    msg.includes("reporte") ||
    msg.includes("estadístic") ||
    msg.includes("analytic") ||
    msg.includes("informe") ||
    msg.includes("métricas")
  ) {
    return { tipo: "pregunta_reportes", confianza: 0.8 }
  }

  // Preguntas sobre impresión / etiquetas / impresoras
  if (
    msg.includes("imprimi") ||
    msg.includes("impresora") ||
    msg.includes("etiqueta") ||
    msg.includes("ticket") ||
    msg.includes("térmica") ||
    msg.includes("termica") ||
    msg.includes("label") ||
    msg.includes("print")
  ) {
    return { tipo: "pregunta_impresion", confianza: 0.8 }
  }

  // Preguntas sobre facturación / cobros
  if (
    msg.includes("factur") ||
    msg.includes("cobr") ||
    msg.includes("pago") ||
    msg.includes("iva") ||
    msg.includes("cuota")
  ) {
    return { tipo: "pregunta_facturacion", confianza: 0.8 }
  }

  // Preguntas sobre app móvil / offline
  if (
    msg.includes("app") ||
    msg.includes("celular") ||
    msg.includes("android") ||
    msg.includes("iphone") ||
    msg.includes("offline") ||
    msg.includes("sin conexión") ||
    msg.includes("descargar")
  ) {
    return { tipo: "pregunta_mobile", confianza: 0.8 }
  }

  // Pregunta sobre funcionalidades generales
  if (
    msg.includes("funciona") ||
    msg.includes("característica") ||
    msg.includes("puede") ||
    msg.includes("permite") ||
    msg.includes("tiene") ||
    msg.includes("sirve") ||
    msg.includes("incluye")
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
