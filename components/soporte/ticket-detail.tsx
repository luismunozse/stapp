"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import {
  ArrowLeft,
  Bug,
  Lightbulb,
  HelpCircle,
  Send,
  Loader2,
  Image as ImageIcon,
  Clock,
  User,
  Headset,
} from "lucide-react"
import type { SupportTicketMessage, SupportTicketAttachment } from "@/types"

interface TicketData {
  id: string
  tipo: string
  prioridad: string
  asunto: string
  descripcion: string
  estado: string
  createdAt: string
  updatedAt: string
  usuario: { nombre: string; email: string } | null
  mensajes: SupportTicketMessage[]
  adjuntos: SupportTicketAttachment[]
}

const tipoConfig: Record<string, { label: string; icon: any; color: string }> = {
  BUG: { label: "Bug / Error", icon: Bug, color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  SUGERENCIA: { label: "Sugerencia", icon: Lightbulb, color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  PREGUNTA: { label: "Pregunta", icon: HelpCircle, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
}

const estadoConfig: Record<string, { label: string; color: string }> = {
  ABIERTO: { label: "Abierto", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  EN_PROCESO: { label: "En proceso", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  RESUELTO: { label: "Resuelto", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  CERRADO: { label: "Cerrado", color: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400" },
}

const prioridadConfig: Record<string, { label: string; color: string }> = {
  BAJA: { label: "Baja", color: "bg-slate-100 text-slate-600" },
  MEDIA: { label: "Media", color: "bg-yellow-100 text-yellow-700" },
  ALTA: { label: "Alta", color: "bg-red-100 text-red-700" },
}

export function TicketDetail({ ticketId }: { ticketId: string }) {
  const router = useRouter()
  const [ticket, setTicket] = useState<TicketData | null>(null)
  const [loading, setLoading] = useState(true)
  const [newMessage, setNewMessage] = useState("")
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const fetchTicket = async () => {
    try {
      const res = await fetch(`/api/soporte/${ticketId}`)
      if (res.ok) {
        const data = await res.json()
        setTicket(data)
      }
    } catch (err) {
      console.error("Error fetching ticket:", err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTicket()
  }, [ticketId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [ticket?.mensajes])

  const handleSend = async () => {
    if (!newMessage.trim() || sending) return
    setSending(true)
    try {
      const res = await fetch(`/api/soporte/${ticketId}/mensajes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contenido: newMessage }),
      })
      if (res.ok) {
        setNewMessage("")
        await fetchTicket()
      }
    } catch (err) {
      console.error("Error sending message:", err)
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!ticket) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Ticket no encontrado</p>
        <Button variant="link" onClick={() => router.push("/soporte")}>
          Volver a soporte
        </Button>
      </div>
    )
  }

  const tipo = tipoConfig[ticket.tipo]
  const estado = estadoConfig[ticket.estado]
  const prioridad = prioridadConfig[ticket.prioridad]
  const TipoIcon = tipo?.icon || HelpCircle
  const isClosed = ticket.estado === "CERRADO"

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push("/soporte")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{ticket.asunto}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${tipo?.color || ""}`}>
              <TipoIcon className="h-3 w-3" />
              {tipo?.label}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${prioridad?.color || ""}`}>
              {prioridad?.label}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${estado?.color || ""}`}>
              {estado?.label}
            </span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDateTime(ticket.createdAt)}
            </span>
          </div>
        </div>
      </div>

      {/* Adjuntos iniciales */}
      {ticket.adjuntos.filter(a => !a.messageId).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              Imágenes adjuntas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 flex-wrap">
              {ticket.adjuntos.filter(a => !a.messageId).map((adj) => (
                <a
                  key={adj.id}
                  href={adj.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                >
                  <img
                    src={adj.url}
                    alt={adj.nombreArchivo || "Adjunto"}
                    className="h-24 w-24 object-cover rounded-lg border hover:opacity-80 transition-opacity"
                  />
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Conversación */}
      <Card className="flex flex-col" style={{ minHeight: "400px" }}>
        <CardHeader className="pb-2 border-b">
          <CardTitle className="text-sm">Conversación</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4" style={{ maxHeight: "500px" }}>
          {ticket.mensajes.map((msg) => {
            const isUser = msg.autorTipo === "USUARIO"
            return (
              <div
                key={msg.id}
                className={`flex ${isUser ? "justify-end" : "justify-start"}`}
              >
                <div className={`max-w-[80%] ${isUser ? "order-1" : ""}`}>
                  <div className={`flex items-center gap-1.5 mb-1 ${isUser ? "justify-end" : ""}`}>
                    {!isUser && <Headset className="h-3 w-3 text-primary" />}
                    {isUser && <User className="h-3 w-3 text-muted-foreground" />}
                    <span className="text-xs font-medium text-muted-foreground">
                      {msg.autorNombre}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(msg.createdAt)}
                    </span>
                  </div>
                  <div
                    className={`rounded-lg px-3 py-2 text-sm ${
                      isUser
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.contenido}</p>
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={messagesEndRef} />
        </CardContent>

        {/* Input de respuesta */}
        {!isClosed ? (
          <div className="border-t p-3">
            <div className="flex gap-2">
              <Textarea
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Escribí tu mensaje... (Enter para enviar)"
                rows={2}
                className="resize-none"
              />
              <Button
                onClick={handleSend}
                disabled={sending || !newMessage.trim()}
                size="icon"
                className="shrink-0 self-end"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
            {ticket.estado === "RESUELTO" && (
              <p className="text-xs text-amber-600 mt-1">
                Al enviar un mensaje, el ticket se reabrirá automáticamente
              </p>
            )}
          </div>
        ) : (
          <div className="border-t p-3 text-center">
            <p className="text-sm text-muted-foreground">
              Este ticket está cerrado y no acepta más mensajes
            </p>
          </div>
        )}
      </Card>
    </div>
  )
}
