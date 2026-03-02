"use client"

import {
  CheckCircle2,
  Clock,
  Camera,
  DollarSign,
  Wrench,
  Package,
  FileText,
  ArrowRight,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface TimelineEvent {
  id: string
  type: "evento" | "foto"
  eventType: string
  estadoAnterior?: string | null
  estadoNuevo?: string | null
  descripcion?: string | null
  url?: string
  fotoTipo?: string
  createdAt: string
  createdBy?: string | null
}

const estadoLabels: Record<string, string> = {
  RECIBIDO: "Recibido",
  EN_DIAGNOSTICO: "En Diagnóstico",
  PRESUPUESTADO: "Presupuestado",
  APROBADO: "Aprobado",
  EN_REPARACION: "En Reparación",
  ESPERANDO_REPUESTO: "Esperando Repuesto",
  REPARADO: "Reparado",
  ENTREGADO: "Entregado",
  CANCELADO: "Cancelado",
  SIN_REPARACION: "Sin Reparación",
}

const eventIcons: Record<string, typeof CheckCircle2> = {
  CAMBIO_ESTADO: ArrowRight,
  FOTO_AGREGADA: Camera,
  PRESUPUESTO_DEFINIDO: DollarSign,
  PRESUPUESTO_APROBADO: CheckCircle2,
  NOTA: FileText,
  REPUESTO_AGREGADO: Package,
}

const eventColors: Record<string, string> = {
  CAMBIO_ESTADO: "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400",
  FOTO_AGREGADA: "bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-400",
  PRESUPUESTO_DEFINIDO: "bg-amber-100 text-amber-600 dark:bg-amber-900 dark:text-amber-400",
  PRESUPUESTO_APROBADO: "bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-400",
  NOTA: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  REPUESTO_AGREGADO: "bg-orange-100 text-orange-600 dark:bg-orange-900 dark:text-orange-400",
}

function formatDate(dateStr: string, timezone?: string) {
  try {
    return new Intl.DateTimeFormat("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone || "America/Argentina/Buenos_Aires",
    }).format(new Date(dateStr))
  } catch {
    return dateStr
  }
}

function getEventDescription(event: TimelineEvent): string {
  if (event.descripcion) return event.descripcion

  switch (event.eventType) {
    case "CAMBIO_ESTADO":
      return `Estado cambiado de ${estadoLabels[event.estadoAnterior || ""] || event.estadoAnterior} a ${estadoLabels[event.estadoNuevo || ""] || event.estadoNuevo}`
    case "FOTO_AGREGADA":
      return `Foto de ${(event.fotoTipo || "").toLowerCase()} agregada`
    case "PRESUPUESTO_DEFINIDO":
      return "Presupuesto definido"
    case "PRESUPUESTO_APROBADO":
      return "Presupuesto aprobado"
    default:
      return event.eventType
  }
}

interface VisualTimelineProps {
  events: TimelineEvent[]
  timezone?: string
}

export function VisualTimeline({ events, timezone }: VisualTimelineProps) {
  if (!events || events.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No hay eventos registrados aún</p>
      </div>
    )
  }

  return (
    <div className="relative">
      {/* Línea vertical */}
      <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-border" />

      <div className="space-y-4">
        {events.map((event, idx) => {
          const Icon = eventIcons[event.eventType] || Clock
          const colorClass = eventColors[event.eventType] || "bg-gray-100 text-gray-600"
          const isLast = idx === events.length - 1

          return (
            <div key={event.id} className="relative flex gap-4">
              {/* Ícono */}
              <div
                className={cn(
                  "relative z-10 flex items-center justify-center w-10 h-10 rounded-full shrink-0",
                  colorClass
                )}
              >
                <Icon className="h-5 w-5" />
              </div>

              {/* Contenido */}
              <div className={cn("flex-1 pb-4", isLast ? "pb-0" : "")}>
                <div className="bg-card border rounded-lg p-3">
                  <p className="text-sm font-medium">
                    {getEventDescription(event)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatDate(event.createdAt, timezone)}
                    {event.createdBy && ` · ${event.createdBy}`}
                  </p>

                  {/* Thumbnail de foto */}
                  {event.type === "foto" && event.url && (
                    <img
                      src={event.url}
                      alt={event.descripcion || "Foto"}
                      className="mt-2 rounded-md max-h-32 object-cover"
                      loading="lazy"
                    />
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
