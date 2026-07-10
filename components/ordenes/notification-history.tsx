"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Mail,
  Clock,
  CheckCircle,
  XCircle,
  Bell,
  ArrowRight,
  FileText,
  MessageSquare,
  Wrench,
  Package,
  Camera,
  History,
} from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import { useCurrency } from "@/contexts/currency-context"
import { ESTADO_LABELS } from "@/lib/orden-state-machine"

interface NotificationLog {
  id: string
  tipo: string
  canal: string
  estado: string
  destinatario: string
  asunto?: string
  createdAt: string
}

interface OrdenEvento {
  id: string
  tipo: string
  estado_anterior: string | null
  estado_nuevo: string | null
  descripcion: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  users: { nombre: string } | null
}

interface TimelineEntry {
  id: string
  source: "evento" | "notificacion"
  date: string
  // evento fields
  tipo?: string
  estadoAnterior?: string | null
  estadoNuevo?: string | null
  descripcion?: string | null
  usuario?: string | null
  // notificacion fields
  canal?: string
  estadoEnvio?: string
  destinatario?: string
  asunto?: string
}

interface NotificationHistoryProps {
  ordenId: string
}

const eventoConfig: Record<string, { label: string; icon: typeof Clock; color: string }> = {
  CAMBIO_ESTADO: { label: "Cambio de estado", icon: ArrowRight, color: "text-blue-600" },
  PRESUPUESTO_DEFINIDO: { label: "Presupuesto definido", icon: FileText, color: "text-purple-600" },
  PRESUPUESTO_APROBADO: { label: "Presupuesto aprobado", icon: CheckCircle, color: "text-green-600" },
  PRESUPUESTO_RECHAZADO: { label: "Presupuesto rechazado", icon: XCircle, color: "text-red-600" },
  NOTA: { label: "Diagnóstico", icon: MessageSquare, color: "text-gray-600" },
  REPUESTO_AGREGADO: { label: "Repuesto agregado", icon: Package, color: "text-orange-600" },
  FOTO_AGREGADA: { label: "Foto agregada", icon: Camera, color: "text-indigo-600" },
  REPARACION: { label: "Reparación", icon: Wrench, color: "text-amber-600" },
}

export function NotificationHistory({ ordenId }: NotificationHistoryProps) {
  const { formatDateTime } = useCurrency()
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTimeline()
  }, [ordenId])

  const fetchTimeline = async () => {
    try {
      const [eventosRes, notifsRes] = await Promise.all([
        fetch(`/api/ordenes/${ordenId}/eventos`),
        fetch(`/api/notificaciones?ordenId=${ordenId}`),
      ])

      const entries: TimelineEntry[] = []

      if (eventosRes.ok) {
        const eventos: OrdenEvento[] = await eventosRes.json()
        for (const e of eventos) {
          entries.push({
            id: e.id,
            source: "evento",
            date: e.created_at,
            tipo: e.tipo,
            estadoAnterior: e.estado_anterior,
            estadoNuevo: e.estado_nuevo,
            descripcion: e.descripcion,
            usuario: e.users?.nombre || null,
          })
        }
      }

      if (notifsRes.ok) {
        const notifs: NotificationLog[] = await notifsRes.json()
        for (const n of notifs) {
          entries.push({
            id: n.id,
            source: "notificacion",
            date: n.createdAt,
            canal: n.canal,
            estadoEnvio: n.estado,
            destinatario: n.destinatario,
            asunto: n.asunto,
            tipo: n.tipo,
          })
        }
      }

      entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      setTimeline(entries)
    } catch (error) {
      console.error("Error fetching timeline:", error)
    } finally {
      setLoading(false)
    }
  }

  const estadoLabel = (estado: string | null | undefined) => {
    if (!estado) return estado
    return (ESTADO_LABELS as Record<string, string>)[estado] || estado
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <History className="h-5 w-5" />
            Historial de la Orden
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Cargando...</div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <History className="h-5 w-5" />
          Historial de la Orden
        </CardTitle>
      </CardHeader>
      <CardContent>
        {timeline.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center">
            No hay actividad registrada para esta orden
          </div>
        ) : (
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />

            <div className="space-y-4">
              {timeline.map((entry) => (
                <div key={`${entry.source}-${entry.id}`} className="flex gap-3 relative">
                  {/* Dot */}
                  <div className={`relative z-10 mt-1 h-[10px] w-[10px] shrink-0 rounded-full border-2 ${
                    entry.source === "notificacion"
                      ? "border-green-500 bg-green-100 dark:bg-green-950"
                      : "border-blue-500 bg-blue-100 dark:bg-blue-950"
                  }`} style={{ marginLeft: "6px" }} />

                  {/* Content */}
                  <div className="flex-1 min-w-0 pb-1">
                    {entry.source === "evento" ? (
                      <EventoEntry entry={entry} estadoLabel={estadoLabel} formatDateTime={formatDateTime} />
                    ) : (
                      <NotificacionEntry entry={entry} formatDateTime={formatDateTime} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function EventoEntry({
  entry,
  estadoLabel,
  formatDateTime,
}: {
  entry: TimelineEntry
  estadoLabel: (s: string | null | undefined) => string | null | undefined
  formatDateTime: (s: string) => string
}) {
  const config = eventoConfig[entry.tipo || ""] || { label: entry.tipo, icon: Clock, color: "text-gray-500" }
  const Icon = config.icon

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        <Icon className={`h-3.5 w-3.5 ${config.color}`} />
        <span className="font-medium text-sm">{config.label}</span>
        {entry.tipo === "CAMBIO_ESTADO" && entry.estadoAnterior && entry.estadoNuevo && (
          <span className="text-sm text-muted-foreground flex items-center gap-1">
            <Badge variant="outline" className="text-xs font-normal">{estadoLabel(entry.estadoAnterior)}</Badge>
            <ArrowRight className="h-3 w-3" />
            <Badge variant="outline" className="text-xs font-normal">{estadoLabel(entry.estadoNuevo)}</Badge>
          </span>
        )}
      </div>
      {entry.descripcion && (
        <p className="text-sm text-muted-foreground mt-0.5">{entry.descripcion}</p>
      )}
      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />
        <span>{formatDateTime(entry.date)}</span>
        {entry.usuario && <span>por {entry.usuario}</span>}
      </div>
    </div>
  )
}

function NotificacionEntry({
  entry,
  formatDateTime,
}: {
  entry: TimelineEntry
  formatDateTime: (s: string) => string
}) {
  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        {entry.canal === "EMAIL" ? (
          <Mail className="h-3.5 w-3.5 text-blue-600" />
        ) : (
          <WhatsAppIcon className="h-3.5 w-3.5 text-green-600" />
        )}
        <span className="font-medium text-sm">
          Notificación {entry.canal === "EMAIL" ? "por email" : "por WhatsApp"}
        </span>
        <Badge
          variant="outline"
          className={`text-xs ${
            entry.estadoEnvio === "ENVIADO"
              ? "text-green-700 dark:text-green-400 border-green-300 dark:border-green-700"
              : "text-red-700 dark:text-red-400 border-red-300 dark:border-red-700"
          }`}
        >
          {entry.estadoEnvio === "ENVIADO" ? (
            <CheckCircle className="h-3 w-3 mr-1" />
          ) : (
            <XCircle className="h-3 w-3 mr-1" />
          )}
          {entry.estadoEnvio === "ENVIADO" ? "Enviado" : "Fallido"}
        </Badge>
      </div>
      {entry.destinatario && (
        <p className="text-sm text-muted-foreground mt-0.5">{entry.destinatario}</p>
      )}
      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />
        <span>{formatDateTime(entry.date)}</span>
      </div>
    </div>
  )
}
