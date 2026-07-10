/**
 * Lógica pura para clasificación y cálculo de progreso de una orden
 * en la vista pública de seguimiento. Aislada del componente React
 * para poder testearla sin renderizar.
 */

export const ESTADO_FLOW = [
  "RECIBIDO",
  "EN_DIAGNOSTICO",
  "PRESUPUESTADO",
  "APROBADO",
  "EN_REPARACION",
  "REPARADO",
  "ENTREGADO",
] as const

export const ESTADOS_RETIRO = new Set([
  "ENTREGADO_SIN_REPARACION",
  "ENTREGADO_SIN_COBRO",
])

export const ESTADOS_TERMINAL = new Set([
  "CANCELADO",
  "SIN_REPARACION",
  "SIN_FALLA_DETECTADA",
])

export const ESTADOS_COMPLETADOS = new Set([
  "ENTREGADO",
  "ENTREGADO_SIN_REPARACION",
  "ENTREGADO_SIN_COBRO",
])

export type EstadoClass = {
  estadoNormalizado: string
  isRetiro: boolean
  isTerminal: boolean
  isCompleted: boolean
  isReady: boolean
  currentIndex: number
  progressPercent: number
}

/**
 * Normaliza el estado y clasifica. Garantías:
 *   - progressPercent ∈ [0, 100], nunca negativo
 *   - currentIndex ∈ [0, flow.length-1]
 *   - estados de retiro no quedan en current/past del flow normal
 *   - acepta input null/undefined/whitespace/casing arbitrario
 */
export function classifyEstado(estadoInput: string | null | undefined): EstadoClass {
  const estadoNormalizado = (estadoInput || "").toUpperCase().trim()
  const isRetiro = ESTADOS_RETIRO.has(estadoNormalizado)
  const isTerminal = ESTADOS_TERMINAL.has(estadoNormalizado)
  const isCompleted = ESTADOS_COMPLETADOS.has(estadoNormalizado)
  const isReady = estadoNormalizado === "REPARADO"

  // Estados sin paso lineal en el flow se mapean a uno cercano
  const estadoParaProgreso =
    estadoNormalizado === "ESPERANDO_REPUESTO" ? "EN_REPARACION" : estadoNormalizado
  const rawIndex = ESTADO_FLOW.indexOf(estadoParaProgreso as (typeof ESTADO_FLOW)[number])
  const currentIndex = rawIndex >= 0 ? rawIndex : 0

  const progressPercent = isTerminal
    ? 0
    : isCompleted
      ? 100
      : Math.max(
          0,
          Math.round((currentIndex / (ESTADO_FLOW.length - 1)) * 100)
        )

  return {
    estadoNormalizado,
    isRetiro,
    isTerminal,
    isCompleted,
    isReady,
    currentIndex,
    progressPercent,
  }
}

export type TimeRemaining = {
  text: string
  urgency: "normal" | "soon" | "overdue"
  diffDays: number
}

/**
 * Convierte un instante a un número de día calendario (días desde epoch UTC)
 * según el calendario de `timeZone`. Permite restar dos fechas y obtener la
 * diferencia en días calendario reales, no en duración cruda.
 */
function calendarDayNumber(date: Date, timeZone?: string): number {
  if (timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    }).formatToParts(date)
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
    return Math.floor(
      Date.UTC(get("year"), get("month") - 1, get("day")) / 86400000
    )
  }
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000
  )
}

/**
 * Calcula tiempo restante hasta una fecha prometida.
 * Devuelve null si no hay fecha.
 * Acepta `now` opcional para tests deterministas y `timeZone` opcional para
 * medir la diferencia en días calendario de la zona horaria del taller.
 *
 * La diferencia se mide en DÍAS CALENDARIO (no en duración): cualquier hora
 * de hoy es "Hoy", el día calendario siguiente es "Mañana", etc. Esto evita
 * que algo vencido en unas horas hoy se muestre como "Mañana".
 */
export function getTimeRemaining(
  fechaPrometida: string | null | undefined,
  now: Date = new Date(),
  timeZone?: string
): TimeRemaining | null {
  if (!fechaPrometida) return null
  const target = new Date(fechaPrometida)
  if (Number.isNaN(target.getTime())) return null

  const diffDays =
    calendarDayNumber(target, timeZone) - calendarDayNumber(now, timeZone)

  if (diffDays < 0) {
    return {
      text: `${Math.abs(diffDays)} día${Math.abs(diffDays) !== 1 ? "s" : ""} de atraso`,
      urgency: "overdue",
      diffDays,
    }
  }
  if (diffDays === 0) return { text: "Hoy", urgency: "soon", diffDays }
  if (diffDays === 1) return { text: "Mañana", urgency: "soon", diffDays }
  if (diffDays <= 3) return { text: `${diffDays} días`, urgency: "soon", diffDays }
  return { text: `${diffDays} días`, urgency: "normal", diffDays }
}

/**
 * Indica si debemos mostrar el bloque "tiempo restante" en la UI.
 * No se muestra cuando la orden ya está cerrada (entregada/retirada/cancelada)
 * o lista para retirar.
 */
export function shouldShowTimeRemaining(c: EstadoClass): boolean {
  return !c.isCompleted && !c.isTerminal && !c.isReady && !c.isRetiro
}

// ========================================
// Motivos de entrega sin cobro
// ========================================

export const MOTIVOS_SIN_COBRO = [
  "NO_REPARABLE",
  "CORTESIA",
  "GARANTIA",
  "CLIENTE_DESISTIO",
  "OTRO",
] as const

export type MotivoSinCobro = (typeof MOTIVOS_SIN_COBRO)[number]

/**
 * Labels cortos para uso interno (select de EntregaDialog, timeline de
 * eventos, detalle de orden). No confundir con `getRetiroLabel`, que arma
 * title/description para el seguimiento público del cliente.
 */
export const MOTIVO_SIN_COBRO_LABELS: Record<MotivoSinCobro, string> = {
  NO_REPARABLE: "No reparable",
  CORTESIA: "Cortesía del taller",
  GARANTIA: "Garantía vigente",
  CLIENTE_DESISTIO: "Cliente desistió",
  OTRO: "Otro motivo",
}

export type RetiroStep = {
  key: string
  label: string
  /** Nombre del ícono lucide-react (resuelto en el componente UI) */
  icon: "Package" | "Search" | "ClipboardCheck" | "Settings" | "CheckCircle2" | "XCircle" | "ThumbsDown" | "ShieldCheck" | "Truck"
}

/**
 * Devuelve el stepper público a mostrar para una orden ENTREGADO_SIN_COBRO,
 * según el motivo elegido al entregar. Cada motivo refleja un camino real
 * distinto del flow normal.
 *
 * Fallback (motivo null/desconocido) = camino "NO_REPARABLE" (histórico).
 */
export function getRetiroStepper(motivo: MotivoSinCobro | string | null | undefined): RetiroStep[] {
  switch (motivo) {
    case "CORTESIA":
      return [
        { key: "RECIBIDO", label: "Recibido", icon: "Package" },
        { key: "DIAGNOSTICO", label: "Diagnóstico", icon: "Search" },
        { key: "REPARADO", label: "Reparado", icon: "CheckCircle2" },
        { key: "RETIRADO_CORTESIA", label: "Retirado · cortesía", icon: "Truck" },
      ]
    case "GARANTIA":
      return [
        { key: "RECIBIDO", label: "Recibido", icon: "Package" },
        { key: "DIAGNOSTICO", label: "Diagnóstico", icon: "Search" },
        { key: "REPARADO", label: "Reparado", icon: "ShieldCheck" },
        { key: "RETIRADO_GARANTIA", label: "Retirado · garantía", icon: "Truck" },
      ]
    case "CLIENTE_DESISTIO":
      return [
        { key: "RECIBIDO", label: "Recibido", icon: "Package" },
        { key: "DIAGNOSTICO", label: "Diagnóstico", icon: "Search" },
        { key: "PRESUPUESTADO", label: "Presupuesto", icon: "ClipboardCheck" },
        { key: "DESISTIO", label: "Cliente desistió", icon: "ThumbsDown" },
        { key: "RETIRADO", label: "Retirado", icon: "Truck" },
      ]
    case "OTRO":
      return [
        { key: "RECIBIDO", label: "Recibido", icon: "Package" },
        { key: "DIAGNOSTICO", label: "Diagnóstico", icon: "Search" },
        { key: "RETIRADO", label: "Retirado sin cobro", icon: "Truck" },
      ]
    case "NO_REPARABLE":
    default:
      return [
        { key: "RECIBIDO", label: "Recibido", icon: "Package" },
        { key: "DIAGNOSTICO", label: "Diagnóstico", icon: "Search" },
        { key: "SIN_REPARACION", label: "Sin reparación", icon: "XCircle" },
        { key: "RETIRADO", label: "Retirado", icon: "Truck" },
      ]
  }
}

/**
 * Label visible en el card de estado del seguimiento público.
 * Diferencia entre los 5 motivos para que el cliente entienda
 * exactamente bajo qué condición se entregó su equipo.
 */
export function getRetiroLabel(motivo: MotivoSinCobro | string | null | undefined): {
  title: string
  description: string
} {
  switch (motivo) {
    case "CORTESIA":
      return {
        title: "Retirado · cortesía del taller",
        description: "Tu equipo fue reparado y entregado sin cargo como cortesía.",
      }
    case "GARANTIA":
      return {
        title: "Retirado · cobertura de garantía",
        description: "Tu equipo fue reparado bajo garantía vigente, sin cargo.",
      }
    case "CLIENTE_DESISTIO":
      return {
        title: "Retirado · sin reparación",
        description: "El cliente desistió de la reparación. El equipo fue retirado sin cargo.",
      }
    case "OTRO":
      return {
        title: "Retirado sin cobro",
        description: "El equipo fue retirado sin cargo.",
      }
    case "NO_REPARABLE":
    default:
      return {
        title: "Retirado · sin reparación",
        description: "El equipo no pudo ser reparado y fue retirado sin cargo.",
      }
  }
}

/**
 * Default sugerido para el select de motivo, basado en el estado actual
 * de la orden al momento de entregarla sin cobro.
 */
export function defaultMotivoSinCobro(estadoActual: string | null | undefined): MotivoSinCobro {
  const e = (estadoActual || "").toUpperCase().trim()
  if (e === "SIN_REPARACION") return "NO_REPARABLE"
  if (e === "SIN_FALLA_DETECTADA") return "OTRO"
  if (e === "REPARADO") return "CORTESIA"
  if (e === "PRESUPUESTADO" || e === "APROBADO" || e === "EN_REPARACION" || e === "ESPERANDO_REPUESTO") {
    return "CLIENTE_DESISTIO"
  }
  return "OTRO"
}
