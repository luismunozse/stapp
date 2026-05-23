"use client"

import { useEffect, useRef, useState } from "react"
import { X, Send, Loader2, Bot, MessageCircle, CheckCircle2 } from "lucide-react"
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
  const [showCaptureBadge, setShowCaptureBadge] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setIsClient(true)
  }, [])

  useEffect(() => {
    if (!isClient) return

    let sid = localStorage.getItem("chatbot-session-id")
    if (!sid) {
      sid = uuidv4()
      localStorage.setItem("chatbot-session-id", sid)
    }
    setSessionId(sid)

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    if (!showCaptureBadge) return
    const t = setTimeout(() => setShowCaptureBadge(false), 4000)
    return () => clearTimeout(t)
  }, [showCaptureBadge])

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

      if (data.leadCaptured && !leadCaptured) {
        setLeadCaptured(true)
        setShowCaptureBadge(true)
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
        "flex flex-col pb-[max(1.5rem,env(safe-area-inset-bottom))]",
        "transition-all duration-300 ease-in-out",
        isOpen ? "scale-100 opacity-100" : "scale-95 opacity-0 pointer-events-none"
      )}
    >
      <div className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 text-white rounded-t-2xl shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center relative animate-pulse-slow">
            <Bot className="w-7 h-7 text-white animate-bounce-subtle" />
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
        {showCaptureBadge && (
          <div className="flex items-center justify-center my-2">
            <span className="inline-flex items-center gap-1.5 text-xs bg-green-50 text-green-700 border border-green-200 px-3 py-1.5 rounded-full animate-in fade-in slide-in-from-bottom-2">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Tus datos quedaron guardados
            </span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

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
