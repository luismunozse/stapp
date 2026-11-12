/**
 * Fuente única de cómo se ve cada estado de orden: etiqueta, ícono, tono de la
 * píldora y color de gráfico. La usan el listado, la ficha, el dashboard, el
 * seguimiento público, el kiosco y los emails. Si agregás un estado nuevo al
 * enum, el `Record<EstadoOrden, …>` obliga a darle una entrada acá.
 */
import {
  Ban,
  CheckCircle2,
  FileText,
  HandCoins,
  Hourglass,
  Inbox,
  PackageCheck,
  PackageX,
  Search,
  SearchCheck,
  ThumbsUp,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react"
import type { EstadoOrden } from "@/types"
import type { StatusTone } from "@/lib/status-tone"

export interface EstadoOrdenUi {
  /** Etiqueta interna (taller), en oración y con tildes. */
  label: string
  /** Etiqueta para el cliente final (seguimiento, kiosco), si difiere. */
  labelCliente: string
  icon: LucideIcon
  tone: StatusTone
  /** Hex para gráficos (recharts) y marcas de color fuera de Tailwind. */
  chartColor: string
}

export const ESTADO_ORDEN_UI: Record<EstadoOrden, EstadoOrdenUi> = {
  RECIBIDO: { label: "Recibido", labelCliente: "Recibido", icon: Inbox, tone: "neutral", chartColor: "#64748b" },
  EN_DIAGNOSTICO: { label: "En diagnóstico", labelCliente: "En diagnóstico", icon: Search, tone: "violet", chartColor: "#8b5cf6" },
  PRESUPUESTADO: { label: "Presupuestado", labelCliente: "Presupuestado", icon: FileText, tone: "warning", chartColor: "#f59e0b" },
  APROBADO: { label: "Aprobado", labelCliente: "Aprobado", icon: ThumbsUp, tone: "info", chartColor: "#0ea5e9" },
  EN_REPARACION: { label: "En reparación", labelCliente: "En reparación", icon: Wrench, tone: "orange", chartColor: "#f97316" },
  ESPERANDO_REPUESTO: { label: "Esperando repuesto", labelCliente: "Esperando repuesto", icon: Hourglass, tone: "pink", chartColor: "#ec4899" },
  REPARADO: { label: "Reparado", labelCliente: "Listo para retirar", icon: CheckCircle2, tone: "cyan", chartColor: "#06b6d4" },
  ENTREGADO: { label: "Entregado", labelCliente: "Entregado", icon: PackageCheck, tone: "success", chartColor: "#22c55e" },
  ENTREGADO_SIN_REPARACION: { label: "Retirado sin reparación", labelCliente: "Retirado sin reparación", icon: PackageX, tone: "warning", chartColor: "#b45309" },
  ENTREGADO_SIN_COBRO: { label: "Entregado sin cobro", labelCliente: "Retirado sin cobro", icon: HandCoins, tone: "emerald", chartColor: "#10b981" },
  CANCELADO: { label: "Cancelado", labelCliente: "Cancelado", icon: Ban, tone: "muted", chartColor: "#94a3b8" },
  SIN_REPARACION: { label: "Sin reparación", labelCliente: "Sin reparación", icon: XCircle, tone: "danger", chartColor: "#ef4444" },
  SIN_FALLA_DETECTADA: { label: "Sin falla detectada", labelCliente: "Sin falla detectada", icon: SearchCheck, tone: "teal", chartColor: "#14b8a6" },
}

/** Todos los estados, en el orden del flujo del taller. */
export const ESTADOS_ORDEN = Object.keys(ESTADO_ORDEN_UI) as EstadoOrden[]

const FALLBACK: EstadoOrdenUi = {
  label: "",
  labelCliente: "",
  icon: Inbox,
  tone: "neutral",
  chartColor: "#64748b",
}

export function esEstadoOrden(estado: string): estado is EstadoOrden {
  return Object.prototype.hasOwnProperty.call(ESTADO_ORDEN_UI, estado)
}

/**
 * Lo que hay que pintar para un estado. Tolera mayúsculas/minúsculas y
 * espacios; un estado desconocido sale neutro con el código crudo como texto.
 */
export function getEstadoOrdenUi(estado: string | null | undefined): EstadoOrdenUi {
  const key = (estado ?? "").trim().toUpperCase()
  if (esEstadoOrden(key)) return ESTADO_ORDEN_UI[key]
  return { ...FALLBACK, label: estado ?? "", labelCliente: estado ?? "" }
}

export interface EstadoOrdenChartDatum {
  estado: EstadoOrden
  name: string
  value: number
  color: string
}

/**
 * Porciones del gráfico "Órdenes por estado": orden del flujo, misma etiqueta
 * y color que la píldora, y solo los estados con al menos una orden.
 */
export function ordenesPorEstadoChartData(
  conteo: Partial<Record<EstadoOrden, number>>
): EstadoOrdenChartDatum[] {
  return ESTADOS_ORDEN.filter((estado) => (conteo[estado] ?? 0) > 0).map((estado) => ({
    estado,
    name: ESTADO_ORDEN_UI[estado].label,
    value: conteo[estado] ?? 0,
    color: ESTADO_ORDEN_UI[estado].chartColor,
  }))
}

export function getEstadoOrdenLabel(estado: string | null | undefined): string {
  return getEstadoOrdenUi(estado).label
}
