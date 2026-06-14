import type { EstadoTurno } from "@/types"

export const ESTADO_LABELS: Record<EstadoTurno, string> = {
  agendado:       "Agendado",
  confirmado:     "Confirmado",
  en_camino:      "En camino",
  realizado:      "Realizado",
  orden_generada: "Orden generada",
  cancelado:      "Cancelado",
  no_show:        "No se presentó",
}

/**
 * Single source of truth for turno-estado color tokens.
 *
 * Fields per state:
 *   bar   — solid color for the 1-px left bar in calendar tiles (turno-block)
 *   bg    — tile background + hover classes (turno-block)
 *   text  — tile text color (turno-block)
 *   dot   — solid color for month-view dot indicators (agenda-view)
 *   badge — badge background + text for the detail-sheet status pill (turno-detail-sheet)
 *
 * VALUES ARE COPIED VERBATIM from the three original maps.
 * Do NOT tokenize — these strings form a data-viz legend and must stay stable.
 */
export const TURNO_ESTADO_STYLES: Record<
  EstadoTurno,
  { bar: string; bg: string; text: string; dot: string; badge: string }
> = {
  agendado: {
    bar:   "bg-blue-500",
    bg:    "bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-950/60",
    text:  "text-blue-900 dark:text-blue-200",
    dot:   "bg-blue-500",
    badge: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  },
  confirmado: {
    bar:   "bg-cyan-500",
    bg:    "bg-cyan-50 dark:bg-cyan-950/40 hover:bg-cyan-100 dark:hover:bg-cyan-950/60",
    text:  "text-cyan-900 dark:text-cyan-200",
    dot:   "bg-cyan-500",
    badge: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
  },
  en_camino: {
    bar:   "bg-amber-500",
    bg:    "bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-950/60",
    text:  "text-amber-900 dark:text-amber-200",
    dot:   "bg-amber-500",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  },
  realizado: {
    bar:   "bg-emerald-500",
    bg:    "bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-950/60",
    text:  "text-emerald-900 dark:text-emerald-200",
    dot:   "bg-emerald-500",
    badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  orden_generada: {
    bar:   "bg-violet-500",
    bg:    "bg-violet-50 dark:bg-violet-950/40 hover:bg-violet-100 dark:hover:bg-violet-950/60",
    text:  "text-violet-900 dark:text-violet-200",
    dot:   "bg-violet-500",
    badge: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  },
  cancelado: {
    bar:   "bg-zinc-400",
    bg:    "bg-zinc-100 dark:bg-zinc-900/40 hover:bg-zinc-200 dark:hover:bg-zinc-900/60",
    text:  "text-zinc-600 dark:text-zinc-400 line-through",
    dot:   "bg-zinc-400",
    badge: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
  },
  no_show: {
    bar:   "bg-red-500",
    bg:    "bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-950/60",
    text:  "text-red-900 dark:text-red-200",
    dot:   "bg-red-500",
    badge: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  },
}
