"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { X, Send, Loader2, Bot, MessageCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { ChatMessage } from "./chat-message"
import { v4 as uuidv4 } from "uuid"

const WHATSAPP_NUMBER = "5491169625733"
const WHATSAPP_MESSAGE = encodeURIComponent(
  "Hola! Estuve chateando con Santi en la web y me gustaría hablar con una persona."
)

interface Message {
  id: string
  tipo: "USER" | "ASSISTANT" | "SYSTEM"
  contenido: string
  timestamp: Date
}

// Extraer email de un texto
function extractEmail(text: string): string | undefined {
  const match = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)
  return match ? match[0] : undefined
}

// Extraer teléfono de un texto (números de 7+ dígitos, con o sin prefijo)
function extractPhone(text: string): string | undefined {
  const match = text.match(/(?:\+?\d[\d\s\-().]{6,}\d)/)
  return match ? match[0].replace(/[\s\-().]/g, "") : undefined
}

// Extraer nombre de frases como "me llamo X", "soy X", "mi nombre es X"
// También detecta respuestas cortas que son solo un nombre (1-3 palabras, capitalizadas)
function extractName(text: string, lastAssistantMessage?: string): string | undefined {
  // Patrones explícitos
  const patterns = [
    /(?:me llamo|mi nombre es|soy)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+)?)/i,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) return match[1].trim()
  }

  // Si el último mensaje del asistente preguntó por el nombre y la respuesta es corta (1-3 palabras),
  // asumir que es un nombre
  if (lastAssistantMessage) {
    const askedForName = /c[oó]mo te llam[aá]s|cu[aá]l es tu nombre|tu nombre|dec[ií]me tu nombre/i.test(lastAssistantMessage)
    if (askedForName) {
      const trimmed = text.trim()
      // Solo palabras (sin números, sin @, sin caracteres especiales)
      if (/^[A-ZÁÉÍÓÚÑa-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+){0,2}$/.test(trimmed) && trimmed.length <= 50) {
        return trimmed
      }
    }
  }

  return undefined
}

// Extraer nombre de empresa/taller del mensaje
function extractCompany(text: string): string | undefined {
  const patterns = [
    /(?:mi (?:taller|service|local|negocio|empresa|tienda) (?:se llama|es))\s+["']?([^"'\n,.]+)/i,
    /(?:(?:taller|service|local|negocio|empresa|tienda))\s+["']([^"']+)["']/i,
    /(?:tengo (?:un |el )?(?:taller|service|local|negocio|empresa|tienda))\s+(?:llamado |que se llama )?["']?([^"'\n,.]+)/i,
    /(?:trabajo en|soy de)\s+["']?([A-ZÁÉÍÓÚÑa-záéíóúñ\s&]+?)(?:\s*[,.\n]|$)/i,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const name = match[1].trim()
      // Evitar falsos positivos con palabras comunes
      if (name.length > 2 && !["un", "una", "el", "la", "los", "las", "que", "con"].includes(name.toLowerCase())) {
        return name
      }
    }
  }
  return undefined
}

interface ChatbotPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function ChatbotPanel({ isOpen, onClose }: ChatbotPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string>("")
  const [conversacionId, setConversacionId] = useState<string | null>(null)
  const [isClient, setIsClient] = useState(false)
  const [leadCaptured, setLeadCaptured] = useState(false)
  const [capturedLeadData, setCapturedLeadData] = useState<{
    nombre?: string
    email?: string
    telefono?: string
    empresa?: string
    interes?: string
    planInteres?: string
  }>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Verificar que estamos en el cliente
  useEffect(() => {
    setIsClient(true)
  }, [])

  // Generar sessionId al montar (solo en cliente)
  useEffect(() => {
    if (!isClient) return

    let sid = localStorage.getItem("chatbot-session-id")
    if (!sid) {
      sid = uuidv4()
      localStorage.setItem("chatbot-session-id", sid)
    }
    setSessionId(sid)

    // Mensaje de bienvenida
    if (messages.length === 0) {
      setMessages([
        {
          id: "welcome",
          tipo: "ASSISTANT",
          contenido:
            "¡Hola! Soy Santi, tu asistente virtual de STApp. Estoy acá para ayudarte con cualquier duda sobre nuestro software de gestión para talleres de reparación. ¿En qué puedo ayudarte hoy?",
          timestamp: new Date(),
        },
      ])
    }
  }, [isClient])

  // Scroll automático al final
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Detectar interés en plan según el contenido del mensaje
  const detectPlanInterest = useCallback((text: string): string | undefined => {
    const msg = text.toLowerCase()
    if (msg.includes("mensual") || msg.includes("por mes")) return "mensual"
    if (msg.includes("anual") || msg.includes("por año")) return "anual"
    if (msg.includes("premium") || msg.includes("plan")) return "premium"
    return undefined
  }, [])

  // Detectar si hay intención de alta conversión (quiere comprar/probar)
  const isHighIntent = useCallback((intencion?: string): boolean => {
    const highIntentTypes = [
      "solicitar_demo",
      "preguntar_precio",
      "comparar_planes",
      "como_empezar",
      "proporcionar_contacto",
      "lead_calificado",
    ]
    return intencion ? highIntentTypes.includes(intencion) : false
  }, [])

  // Captura progresiva de leads: envía datos cada vez que detecta algo nuevo
  const tryCaptureLead = useCallback(
    async (userText: string, convId: string, intencion?: string, lastAssistantMsg?: string) => {
      const email = extractEmail(userText)
      const phone = extractPhone(userText)
      const name = extractName(userText, lastAssistantMsg)
      const company = extractCompany(userText)
      const planInterest = detectPlanInterest(userText)

      // Construir datos nuevos solo con lo que se detectó ahora
      const newData: typeof capturedLeadData = {}
      if (name && !capturedLeadData.nombre) newData.nombre = name
      if (email && !capturedLeadData.email) newData.email = email
      if (phone && !capturedLeadData.telefono) newData.telefono = phone
      if (company && !capturedLeadData.empresa) newData.empresa = company
      if (planInterest && !capturedLeadData.planInteres) newData.planInteres = planInterest

      // Determinar el interés basado en la intención
      if (intencion && !capturedLeadData.interes) {
        const interesMap: Record<string, string> = {
          solicitar_demo: "Solicitud de demo",
          preguntar_precio: "Consulta de precios",
          comparar_planes: "Comparación de planes",
          como_empezar: "Quiere empezar a usar STApp",
          lead_calificado: "Tiene taller/negocio - Lead calificado",
          pregunta_funcionalidad: "Consulta sobre funcionalidades",
          pregunta_impresion: "Consulta sobre impresión",
          pregunta_facturacion: "Consulta sobre facturación",
          pregunta_mobile: "Consulta sobre app móvil",
          pregunta_comunicaciones: "Consulta sobre WhatsApp/notificaciones",
          pregunta_reportes: "Consulta sobre reportes",
          pregunta_seguridad: "Consulta sobre seguridad",
        }
        if (interesMap[intencion]) newData.interes = interesMap[intencion]
      }

      // Si no hay datos nuevos, no hacer nada
      if (Object.keys(newData).length === 0) return

      // Merge con datos acumulados
      const mergedData = { ...capturedLeadData, ...newData }

      // Solo enviar al backend si tenemos al menos email o teléfono
      if (!mergedData.email && !mergedData.telefono) {
        // Guardar datos parciales (nombre, empresa) para enviar después cuando llegue email/teléfono
        setCapturedLeadData(mergedData)
        return
      }

      try {
        const res = await fetch("/api/chatbot/capture-lead", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            conversacionId: convId,
            nombre: mergedData.nombre || undefined,
            email: mergedData.email || undefined,
            telefono: mergedData.telefono || undefined,
            empresa: mergedData.empresa || undefined,
            interes: mergedData.interes || "Consulta desde chatbot",
            planInteres: mergedData.planInteres || undefined,
          }),
        })

        if (res.ok) {
          setCapturedLeadData(mergedData)
          setLeadCaptured(true)
        }
      } catch (err) {
        console.error("Error capturing lead:", err)
      }
    },
    [sessionId, capturedLeadData, detectPlanInterest]
  )

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading || !sessionId) return

    const userMessage: Message = {
      id: uuidv4(),
      tipo: "USER",
      contenido: input.trim(),
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsLoading(true)

    try {
      const response = await fetch("/api/chatbot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          message: userMessage.contenido,
          conversacionId,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Error en la respuesta")
      }

      const data = await response.json()

      const currentConvId = data.conversacionId || conversacionId
      if (data.conversacionId && !conversacionId) {
        setConversacionId(data.conversacionId)
      }

      const assistantMessage: Message = {
        id: uuidv4(),
        tipo: "ASSISTANT",
        contenido: data.message,
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, assistantMessage])

      // Captura progresiva de leads: siempre intentar extraer datos de cada mensaje
      if (currentConvId) {
        // Obtener el último mensaje del asistente ANTES de este (para contexto de nombre)
        const previousAssistantMsgs = messages.filter((m) => m.tipo === "ASSISTANT")
        const lastAssistantMsg = previousAssistantMsgs.length > 0
          ? previousAssistantMsgs[previousAssistantMsgs.length - 1].contenido
          : undefined

        const hasContactInfo =
          extractEmail(userMessage.contenido) ||
          extractPhone(userMessage.contenido) ||
          extractName(userMessage.contenido, lastAssistantMsg) ||
          extractCompany(userMessage.contenido)
        const hasHighIntent = isHighIntent(data.intencion)
        const hasAnyIntent = data.intencion && data.intencion !== "saludo" && data.intencion !== "pregunta_general"

        // Capturar datos si: tiene info de contacto, intención alta, o ya capturamos algo antes
        if (hasContactInfo || hasHighIntent || hasAnyIntent || Object.keys(capturedLeadData).length > 0) {
          tryCaptureLead(userMessage.contenido, currentConvId, data.intencion, lastAssistantMsg)
        }
      }
    } catch (error) {
      console.error("Error sending message:", error)
      const errorMessage: Message = {
        id: uuidv4(),
        tipo: "SYSTEM",
        contenido:
          error instanceof Error
            ? error.message
            : "Lo siento, hubo un error. Por favor intentá de nuevo.",
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  if (!isOpen) return null

  return (
    <div
      className={cn(
        "fixed bottom-6 right-6 z-50",
        "w-[90vw] max-w-md h-[600px] max-h-[80vh]",
        "bg-card border shadow-2xl rounded-2xl",
        "flex flex-col",
        "transition-all duration-300 ease-in-out",
        isOpen ? "scale-100 opacity-100" : "scale-95 opacity-0 pointer-events-none"
      )}
    >
      {/* Header con robot animado */}
      <div className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 text-white rounded-t-2xl shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center relative animate-pulse-slow">
            <Bot className="w-7 h-7 text-white animate-bounce-subtle" />
            {/* Badge online */}
            <span className="absolute -bottom-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500 border-2 border-white"></span>
            </span>
          </div>
          <div>
            <h3 className="font-bold text-lg flex items-center gap-2">
              Santi
              <span className="text-xs font-normal bg-white/20 px-2 py-0.5 rounded-full">AI</span>
            </h3>
            <p className="text-xs opacity-95 flex items-center gap-1">
              <span className="inline-block w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
              En línea • Asistente virtual
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="text-white hover:bg-white/20 transition-all duration-200"
        >
          <X className="w-5 h-5" />
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}
        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground mb-4">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
            </div>
            <span className="text-sm">Santi está escribiendo...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Escribí tu mensaje..."
            disabled={isLoading}
            className="flex-1"
          />
          <Button onClick={handleSendMessage} disabled={isLoading || !input.trim()} size="icon">
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-muted-foreground">
            Presioná Enter para enviar
          </p>
          <a
            href={`https://wa.me/${WHATSAPP_NUMBER}?text=${WHATSAPP_MESSAGE}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 font-medium transition-colors"
          >
            <MessageCircle className="w-3.5 h-3.5" />
            Hablar con una persona
          </a>
        </div>
      </div>
    </div>
  )
}
