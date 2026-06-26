"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Bot,
  User,
  Clock,
  MessageCircle,
  RefreshCw,
  Filter,
  Loader2,
  UserCheck,
  UserX,
  ArrowLeft,
  Globe,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useSuperadminFetch } from "@/hooks/use-superadmin-fetch"
import { cn } from "@/lib/utils"
import { DEFAULT_TIMEZONE } from "@/lib/timezone"

interface ConversacionResumen {
  id: string
  session_id: string
  ip_address: string | null
  referrer: string | null
  created_at: string
  activa: boolean
  lead_capturado: boolean
  lead_id: string | null
  leads: {
    id: string
    nombre: string | null
    email: string | null
    telefono: string | null
    estado: string
  } | null
  mensaje_count: number
  ultimo_mensaje_usuario: string | null
  ultimo_mensaje_fecha: string
}

interface ConversacionDetalle {
  conversacion: any
  mensajes: {
    id: string
    tipo: "USER" | "ASSISTANT"
    contenido: string
    intencion_detectada: string | null
    confianza: number | null
    tiempo_respuesta_ms: number | null
    created_at: string
  }[]
}

interface ConversacionesResponse {
  conversaciones: ConversacionResumen[]
  total: number
}

export function ConversacionesContent() {
  const { data, loading, fetchData } = useSuperadminFetch<ConversacionesResponse>({ showErrorToast: true })
  const { data: detalle, loading: loadingDetalle, fetchData: fetchDetalle } = useSuperadminFetch<ConversacionDetalle>({ showErrorToast: true })
  const [filtro, setFiltro] = useState("TODOS")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const loadConversaciones = useCallback(async () => {
    const params = new URLSearchParams()
    if (filtro === "CON_LEAD") params.set("solo_con_lead", "true")
    if (filtro === "SIN_LEAD") params.set("solo_sin_lead", "true")
    await fetchData(`/api/superadmin/conversaciones?${params.toString()}`)
  }, [fetchData, filtro])

  useEffect(() => {
    loadConversaciones()
  }, [loadConversaciones])

  const handleSelectConv = async (id: string) => {
    setSelectedId(id)
    await fetchDetalle(`/api/superadmin/conversaciones/${id}`)
  }

  const conversaciones = data?.conversaciones || []
  const total = data?.total || 0

  // Vista de detalle
  if (selectedId && detalle) {
    const conv = detalle.conversacion
    const msgs = detalle.mensajes
    const lead = conv.leads

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setSelectedId(null)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Bot className="w-5 h-5 text-purple-500" />
              Conversación
            </h1>
            <p className="text-muted-foreground text-sm">
              {new Date(conv.created_at).toLocaleDateString("es-AR", {
                day: "2-digit",
                month: "long",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                timeZone: DEFAULT_TIMEZONE,
              })}
              {" - "}
              {msgs.length} mensajes
              {conv.ip_address && ` - IP: ${conv.ip_address}`}
            </p>
          </div>
          {lead && (
            <Button variant="outline" size="sm" onClick={() => window.location.href = `/superadmin/leads/${lead.id}`}>
              Ver lead: {lead.nombre || lead.email || lead.telefono}
            </Button>
          )}
        </div>

        <Card>
          <CardContent className="pt-4">
            <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-2">
              {msgs.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "flex gap-2.5",
                    msg.tipo === "USER" ? "flex-row-reverse" : "flex-row"
                  )}
                >
                  <div className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0",
                    msg.tipo === "USER"
                      ? "bg-primary/10 text-primary"
                      : "bg-purple-500/10 text-purple-500"
                  )}>
                    {msg.tipo === "USER" ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                  </div>
                  <div className={cn(
                    "max-w-[75%] rounded-xl px-3 py-2",
                    msg.tipo === "USER"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  )}>
                    <p className="text-sm whitespace-pre-wrap">{msg.contenido}</p>
                    <div className={cn(
                      "flex items-center gap-2 mt-1 text-[10px]",
                      msg.tipo === "USER" ? "text-primary-foreground/60" : "text-muted-foreground"
                    )}>
                      <Clock className="w-2.5 h-2.5" />
                      {new Date(msg.created_at).toLocaleTimeString("es-AR", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                        timeZone: DEFAULT_TIMEZONE,
                      })}
                      {msg.intencion_detectada && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5">
                          {msg.intencion_detectada}
                          {msg.confianza && ` (${Math.round(msg.confianza * 100)}%)`}
                        </Badge>
                      )}
                      {msg.tiempo_respuesta_ms && (
                        <span>{msg.tiempo_respuesta_ms}ms</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Vista de lista
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Conversaciones del Chatbot</h1>
          <p className="text-muted-foreground text-sm">
            Todas las conversaciones con Santi, incluyendo visitantes anónimos
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadConversaciones} disabled={loading}>
          <RefreshCw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} />
          Actualizar
        </Button>
      </div>

      {/* Filter */}
      <div className="flex gap-3">
        <Select value={filtro} onValueChange={setFiltro}>
          <SelectTrigger className="w-[200px]">
            <Filter className="w-4 h-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="TODOS">Todas las conversaciones</SelectItem>
            <SelectItem value="CON_LEAD">Con lead capturado</SelectItem>
            <SelectItem value="SIN_LEAD">Sin lead (anónimas)</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="h-9 px-3 flex items-center">
          {loading && !data ? (
            <span className="inline-block h-3 w-20 bg-muted-foreground/20 rounded animate-pulse" />
          ) : (
            `${total} conversaciones`
          )}
        </Badge>
      </div>

      {/* List */}
      <Card>
        <CardContent className="pt-4">
          {loading && !data ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 p-3 rounded-lg border animate-pulse"
                >
                  <div className="w-10 h-10 rounded-full bg-muted flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-1/3 bg-muted rounded" />
                    <div className="h-3 w-2/3 bg-muted rounded" />
                  </div>
                  <div className="h-3 w-16 bg-muted rounded" />
                </div>
              ))}
            </div>
          ) : conversaciones.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <MessageCircle className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>No hay conversaciones</p>
            </div>
          ) : (
            <div className="space-y-2">
              {conversaciones.map((conv) => (
                <div
                  key={conv.id}
                  className="flex items-center gap-4 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => handleSelectConv(conv.id)}
                >
                  {/* Icon */}
                  <div className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0",
                    conv.lead_capturado
                      ? "bg-green-500/10 text-green-600"
                      : "bg-muted text-muted-foreground"
                  )}>
                    {conv.lead_capturado ? <UserCheck className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {conv.leads ? (
                        <span className="font-medium text-sm truncate">
                          {conv.leads.nombre || conv.leads.email || conv.leads.telefono || "Lead sin datos"}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">Visitante anónimo</span>
                      )}
                      {conv.lead_capturado && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-green-500/10 text-green-700">
                          Lead
                        </Badge>
                      )}
                    </div>
                    {conv.ultimo_mensaje_usuario && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {conv.ultimo_mensaje_usuario}
                      </p>
                    )}
                  </div>

                  {/* Meta */}
                  <div className="flex items-center gap-3 flex-shrink-0 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <MessageCircle className="w-3 h-3" />
                      {conv.mensaje_count}
                    </span>
                    <span className="hidden sm:block">
                      {new Date(conv.created_at).toLocaleDateString("es-AR", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: DEFAULT_TIMEZONE,
                      })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
