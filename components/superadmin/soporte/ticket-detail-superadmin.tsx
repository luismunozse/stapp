"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
  Building2,
  Mail,
  Paperclip,
  X,
  CheckCheck,
  Check,
  FileText,
} from "lucide-react"
import { toast } from "sonner"
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
  organizacion: { nombre: string; slug: string } | null
  mensajes: SupportTicketMessage[]
  adjuntos: SupportTicketAttachment[]
}

const tipoConfig: Record<string, { label: string; icon: any; color: string }> = {
  BUG: { label: "Bug / Error", icon: Bug, color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  SUGERENCIA: { label: "Sugerencia", icon: Lightbulb, color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  PREGUNTA: { label: "Pregunta", icon: HelpCircle, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
}

const estadoConfig: Record<string, { label: string; color: string }> = {
  ABIERTO: { label: "Abierto", color: "bg-blue-100 text-blue-700" },
  EN_PROCESO: { label: "En proceso", color: "bg-amber-100 text-amber-700" },
  RESUELTO: { label: "Resuelto", color: "bg-green-100 text-green-700" },
  CERRADO: { label: "Cerrado", color: "bg-gray-100 text-gray-700" },
}

const prioridadConfig: Record<string, { label: string; color: string }> = {
  BAJA: { label: "Baja", color: "bg-slate-100 text-slate-600" },
  MEDIA: { label: "Media", color: "bg-yellow-100 text-yellow-700" },
  ALTA: { label: "Alta", color: "bg-red-100 text-red-700" },
}

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const date = new Date(dateStr).getTime()
  const diff = Math.floor((now - date) / 1000)

  if (diff < 60) return "ahora"
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`
  if (diff < 604800) return `hace ${Math.floor(diff / 86400)}d`
  return new Date(dateStr).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

const POLL_INTERVAL = 30_000 // 30 seconds

export function TicketDetailSuperadmin({ ticketId }: { ticketId: string }) {
  const router = useRouter()
  const [ticket, setTicket] = useState<TicketData | null>(null)
  const [loading, setLoading] = useState(true)
  const [newMessage, setNewMessage] = useState("")
  const [sending, setSending] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [selectedImages, setSelectedImages] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchTicket = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const res = await fetch(`/api/superadmin/soporte/${ticketId}`)
      if (res.ok) {
        setTicket(await res.json())
      }
    } catch (err) {
      console.error("Error:", err)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [ticketId])

  const markAsRead = async () => {
    try {
      await fetch(`/api/superadmin/soporte/${ticketId}/leido`, { method: "POST" })
    } catch (err) {
      console.error("Error marking as read:", err)
    }
  }

  useEffect(() => {
    fetchTicket()
  }, [fetchTicket])

  // Auto-refresh polling cada 30s
  useEffect(() => {
    pollRef.current = setInterval(() => {
      fetchTicket(true)
    }, POLL_INTERVAL)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [fetchTicket])

  // Marcar mensajes del usuario como leidos al abrir el chat
  useEffect(() => {
    if (ticket?.mensajes?.some(m => m.autorTipo === "USUARIO" && !m.leidoAt)) {
      markAsRead()
    }
  }, [ticket?.mensajes])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [ticket?.mensajes])

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    const remaining = 3 - selectedImages.length
    const toProcess = Array.from(files).slice(0, remaining)

    toProcess.forEach((file) => {
      if (!file.type.startsWith("image/")) return
      if (file.size > 5 * 1024 * 1024) return
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setSelectedImages((prev) => [...prev, reader.result as string])
        }
      }
      reader.readAsDataURL(file)
    })
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const removeImage = (index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSend = async () => {
    if ((!newMessage.trim() && selectedImages.length === 0) || sending) return
    setSending(true)
    try {
      const res = await fetch(`/api/superadmin/soporte/${ticketId}/mensajes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contenido: newMessage || "(imagen adjunta)",
          ...(selectedImages.length > 0 && { imagenes: selectedImages }),
        }),
      })
      if (res.ok) {
        setNewMessage("")
        setSelectedImages([])
        toast.success("Mensaje enviado")
        await fetchTicket()
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || "Error al enviar mensaje")
      }
    } catch (err) {
      console.error("Error:", err)
      toast.error("Error al enviar mensaje")
    } finally {
      setSending(false)
    }
  }

  const handleStatusChange = async (newEstado: string) => {
    setUpdatingStatus(true)
    try {
      const res = await fetch(`/api/superadmin/soporte/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: newEstado }),
      })
      if (res.ok) {
        const estadoLabel = estadoConfig[newEstado]?.label || newEstado
        toast.success(`Estado cambiado a ${estadoLabel}`)
        await fetchTicket()
      } else {
        toast.error("Error al cambiar estado")
      }
    } catch (err) {
      console.error("Error:", err)
      toast.error("Error al cambiar estado")
    } finally {
      setUpdatingStatus(false)
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    const remaining = 3 - selectedImages.length
    if (remaining <= 0) return

    const imageItems = Array.from(items).filter((item) => item.type.startsWith("image/"))
    if (imageItems.length === 0) return

    e.preventDefault()
    imageItems.slice(0, remaining).forEach((item) => {
      const file = item.getAsFile()
      if (!file || file.size > 5 * 1024 * 1024) return
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setSelectedImages((prev) => [...prev, reader.result as string])
        }
      }
      reader.readAsDataURL(file)
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
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
        <Button variant="link" onClick={() => router.push("/superadmin/soporte")}>
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
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push("/superadmin/soporte")} className="shrink-0 mt-1">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">{ticket.asunto}</h1>
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
          </div>
        </div>
        {/* Status control */}
        <div className="shrink-0">
          <Select
            value={ticket.estado}
            onValueChange={handleStatusChange}
            disabled={updatingStatus}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ABIERTO">Abierto</SelectItem>
              <SelectItem value="EN_PROCESO">En proceso</SelectItem>
              <SelectItem value="RESUELTO">Resuelto</SelectItem>
              <SelectItem value="CERRADO">Cerrado</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Info del usuario y organizacion */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center gap-4 flex-wrap text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Building2 className="h-4 w-4" />
              {ticket.organizacion?.nombre || "Sin org"}
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <User className="h-4 w-4" />
              {ticket.usuario?.nombre || "Usuario"}
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Mail className="h-4 w-4" />
              {ticket.usuario?.email || "-"}
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Clock className="h-4 w-4" />
              {timeAgo(ticket.createdAt)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Adjuntos iniciales */}
      {ticket.adjuntos.filter(a => !a.messageId).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              Imagenes adjuntas
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

      {/* Conversacion */}
      <Card className="flex flex-col" style={{ minHeight: "400px" }}>
        <CardHeader className="pb-2 border-b">
          <CardTitle className="text-sm">Conversacion</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4" style={{ maxHeight: "500px" }}>
          {/* Descripcion original del ticket como primer mensaje */}
          {ticket.descripcion && (
            <div className="flex justify-start">
              <div className="max-w-[80%]">
                <div className="flex items-center gap-1.5 mb-1">
                  <FileText className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">
                    Descripcion original
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {timeAgo(ticket.createdAt)}
                  </span>
                </div>
                <div className="rounded-lg px-3 py-2 text-sm bg-muted border-l-4 border-muted-foreground/20">
                  <p className="whitespace-pre-wrap">{ticket.descripcion}</p>
                </div>
              </div>
            </div>
          )}

          {ticket.mensajes.map((msg) => {
            const isSuperadmin = msg.autorTipo === "SUPERADMIN"
            return (
              <div
                key={msg.id}
                className={`flex ${isSuperadmin ? "justify-end" : "justify-start"}`}
              >
                <div className="max-w-[80%]">
                  <div className={`flex items-center gap-1.5 mb-1 ${isSuperadmin ? "justify-end" : ""}`}>
                    {!isSuperadmin && <User className="h-3 w-3 text-muted-foreground" />}
                    {isSuperadmin && <Headset className="h-3 w-3 text-primary" />}
                    <span className="text-xs font-medium text-muted-foreground">
                      {msg.autorNombre}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {timeAgo(msg.createdAt)}
                    </span>
                  </div>
                  <div
                    className={`rounded-lg px-3 py-2 text-sm ${
                      isSuperadmin
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.contenido}</p>
                    {msg.adjuntos && msg.adjuntos.length > 0 && (
                      <div className="flex gap-2 flex-wrap mt-2">
                        {msg.adjuntos.map((adj) => (
                          <a
                            key={adj.id}
                            href={adj.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <img
                              src={adj.url}
                              alt={adj.nombreArchivo || "Adjunto"}
                              className="h-20 w-20 object-cover rounded border border-white/20 hover:opacity-80 transition-opacity"
                            />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Indicador de leido para mensajes del superadmin */}
                  {isSuperadmin && (
                    <div className={`flex items-center justify-end mt-0.5 gap-0.5`}>
                      {msg.leidoAt ? (
                        <CheckCheck className="h-3.5 w-3.5 text-blue-500" />
                      ) : (
                        <Check className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          <div ref={messagesEndRef} />
        </CardContent>

        {/* Input de respuesta */}
        {!isClosed ? (
          <div className="border-t p-3 space-y-2">
            {/* Preview de imagenes seleccionadas */}
            {selectedImages.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {selectedImages.map((img, i) => (
                  <div key={i} className="relative group">
                    <img
                      src={img}
                      alt={`Adjunto ${i + 1}`}
                      className="h-16 w-16 object-cover rounded-lg border"
                    />
                    <button
                      onClick={() => removeImage(i)}
                      className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleImageSelect}
              />
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 self-end"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending || selectedImages.length >= 3}
                title="Adjuntar imagen (max. 3)"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Textarea
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder="Responder como Soporte STApp... (Enter para enviar)"
                rows={2}
                className="resize-none"
              />
              <Button
                onClick={handleSend}
                disabled={sending || (!newMessage.trim() && selectedImages.length === 0)}
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
          </div>
        ) : (
          <div className="border-t p-3 text-center">
            <p className="text-sm text-muted-foreground">
              Ticket cerrado. Cambia el estado para reactivar la conversacion.
            </p>
          </div>
        )}
      </Card>
    </div>
  )
}
