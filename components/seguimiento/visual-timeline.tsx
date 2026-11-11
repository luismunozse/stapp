"use client"

import {
  CheckCircle2,
  Clock,
  Camera,
  DollarSign,
  ArrowRight,
  XCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Evento tal como lo devuelve /api/public/ordenes/[token]/timeline. El
 * endpoint es público: sólo trae tipo, estado nuevo y fecha (más URL/tipo de
 * foto). Nada de descripciones internas, metadata ni quién lo hizo.
 */
export interface TimelineEvent {
  id: string
  type: "evento" | "foto"
  eventType: string
  estadoNuevo?: string | null
  descripcion?: string | null
  url?: string
  fotoTipo?: string
  createdAt: string
}

const estadoLabels: Record<string, string> = {
  RECIBIDO: "Recibido",
  EN_DIAGNOSTICO: "En diagnóstico",
  PRESUPUESTADO: "Presupuestado",
  APROBADO: "Aprobado",
  EN_REPARACION: "En reparación",
  ESPERANDO_REPUESTO: "Esperando repuesto",
  REPARADO: "Listo para retirar",
  ENTREGADO: "Entregado",
  ENTREGADO_SIN_REPARACION: "Retirado sin reparación",
  ENTREGADO_SIN_COBRO: "Retirado sin cobro",
  CANCELADO: "Cancelado",
  SIN_REPARACION: "Sin reparación",
  SIN_FALLA_DETECTADA: "Sin falla detectada",
}

/** Texto para el cliente al llegar a cada estado (en vez de "Estado cambiado de X a Y"). */
const estadoTextos: Record<string, string> = {
  RECIBIDO: "Ingresó al taller",
  EN_DIAGNOSTICO: "Empezamos el diagnóstico",
  PRESUPUESTADO: "El presupuesto está listo para que lo revises",
  APROBADO: "Presupuesto aprobado",
  EN_REPARACION: "Empezamos a trabajar",
  ESPERANDO_REPUESTO: "Estamos esperando un repuesto",
  REPARADO: "¡Listo para retirar!",
  ENTREGADO: "Entregado. ¡Gracias por confiar en nosotros!",
  ENTREGADO_SIN_REPARACION: "Retirado sin reparación",
  ENTREGADO_SIN_COBRO: "Retirado sin cobro",
  CANCELADO: "La orden fue cancelada",
  SIN_REPARACION: "No fue posible hacer la reparación",
  SIN_FALLA_DETECTADA: "Lo revisamos y no detectamos la falla reportada",
}

const fotoTextos: Record<string, string> = {
  INGRESO: "Foto del ingreso",
  REPARACION: "Foto de la reparación",
  ENTREGA: "Foto de la entrega",
}

const eventIcons: Record<string, typeof CheckCircle2> = {
  CAMBIO_ESTADO: ArrowRight,
  FOTO_AGREGADA: Camera,
  PRESUPUESTO_DEFINIDO: DollarSign,
  PRESUPUESTO_APROBADO: CheckCircle2,
  PRESUPUESTO_RECHAZADO: XCircle,
}

const eventColors: Record<string, string> = {
  CAMBIO_ESTADO: "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400",
  FOTO_AGREGADA: "bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-400",
  PRESUPUESTO_DEFINIDO: "bg-amber-100 text-amber-600 dark:bg-amber-900 dark:text-amber-400",
  PRESUPUESTO_APROBADO: "bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-400",
  PRESUPUESTO_RECHAZADO: "bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-400",
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

export function getEventDescription(event: TimelineEvent): string {
  switch (event.eventType) {
    case "CAMBIO_ESTADO": {
      const estado = event.estadoNuevo || ""
      if (estadoTextos[estado]) return estadoTextos[estado]
      return estadoLabels[estado] ? `Nuevo estado: ${estadoLabels[estado]}` : "Actualizamos el estado de tu orden"
    }
    case "FOTO_AGREGADA":
      return fotoTextos[event.fotoTipo || ""] || "Agregamos una foto"
    case "PRESUPUESTO_DEFINIDO":
      return "El presupuesto está listo para que lo revises"
    case "PRESUPUESTO_APROBADO":
      return "Presupuesto aprobado"
    case "PRESUPUESTO_RECHAZADO":
      return "Presupuesto rechazado"
    default:
      return "Actualizamos tu orden"
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
        <p className="text-sm">Todavía no hay novedades</p>
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
                  </p>

                  {/* Thumbnail de foto */}
                  {event.type === "foto" && event.url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={event.url}
                      alt={event.descripcion || getEventDescription(event)}
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
