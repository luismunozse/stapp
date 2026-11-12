import { Bug, HelpCircle, Lightbulb, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { StatusTone } from "@/lib/status-tone"
import { statusToneClasses } from "@/components/ui/status-pill"

/**
 * Etiqueta y tono de tipo, estado y prioridad de tickets de soporte. Lo usan la
 * vista del taller y la del superadmin; antes había cuatro copias con colores
 * distintos y algunas sin modo oscuro.
 *
 * `color` son las clases soft del tono (texto 700 sobre fondo 50, ≥4,5:1) más
 * el borde, para los `<span>` y recuadros de ícono que ya existían.
 */
type Entrada = { label: string; tone: StatusTone; color: string }

const entrada = (label: string, tone: StatusTone): Entrada => ({
  label,
  tone,
  color: cn("border", statusToneClasses(tone)),
})

export const TICKET_TIPO: Record<string, Entrada & { icon: LucideIcon }> = {
  BUG: { ...entrada("Bug / Error", "danger"), icon: Bug },
  SUGERENCIA: { ...entrada("Sugerencia", "warning"), icon: Lightbulb },
  PREGUNTA: { ...entrada("Pregunta", "info"), icon: HelpCircle },
}

export const TICKET_ESTADO: Record<string, Entrada> = {
  ABIERTO: entrada("Abierto", "info"),
  EN_PROCESO: entrada("En proceso", "warning"),
  RESUELTO: entrada("Resuelto", "success"),
  CERRADO: entrada("Cerrado", "muted"),
}

export const TICKET_PRIORIDAD: Record<string, Entrada> = {
  BAJA: entrada("Baja", "neutral"),
  MEDIA: entrada("Media", "warning"),
  ALTA: entrada("Alta", "danger"),
}
