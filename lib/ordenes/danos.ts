import { z } from "zod"
import { CircleDot, CircleOff, Droplets, MoreHorizontal, PenLine, Zap, type LucideIcon } from "lucide-react"
import { diagramaPorRef, refDiagrama, resolverDiagrama, type VistaId } from "@/components/ordenes/danos/diagramas"

export const TIPOS_DANO = ["rayon", "golpe", "rotura", "faltante", "humedad", "otro"] as const
export type TipoDano = (typeof TIPOS_DANO)[number]

export const TIPO_DANO_META: Record<
  TipoDano,
  { label: string; icon: LucideIcon; colorClass: string; pdfRgb: [number, number, number] }
> = {
  rayon: { label: "Rayón", icon: PenLine, colorClass: "text-amber-600 dark:text-amber-400", pdfRgb: [0.85, 0.47, 0.02] },
  golpe: { label: "Golpe", icon: CircleDot, colorClass: "text-orange-600 dark:text-orange-400", pdfRgb: [0.92, 0.35, 0.05] },
  rotura: { label: "Rotura", icon: Zap, colorClass: "text-red-600 dark:text-red-400", pdfRgb: [0.86, 0.15, 0.15] },
  faltante: { label: "Faltante", icon: CircleOff, colorClass: "text-violet-600 dark:text-violet-400", pdfRgb: [0.49, 0.23, 0.93] },
  humedad: { label: "Humedad", icon: Droplets, colorClass: "text-sky-600 dark:text-sky-400", pdfRgb: [0.01, 0.52, 0.78] },
  otro: { label: "Otro", icon: MoreHorizontal, colorClass: "text-slate-600 dark:text-slate-300", pdfRgb: [0.28, 0.33, 0.41] },
}

export const MAX_DANOS_POR_ORDEN = 30
export const VENTANA_BORRADO_DIAGNOSTICO_MS = 10 * 60 * 1000
export const ESTADOS_SIN_NUEVOS_DANOS = ["ENTREGADO", "ENTREGADO_SIN_REPARACION", "ENTREGADO_SIN_COBRO", "CANCELADO"] as const

export type DanoInput = {
  diagrama: string
  vista: VistaId
  x: number
  y: number
  tipo: TipoDano
  nota?: string | null
}

export const danoInputSchema: z.ZodType<DanoInput> = z.object({
  diagrama: z.string().min(1).max(64),
  vista: z.enum(["frente", "dorso", "lateral"]),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  tipo: z.enum(TIPOS_DANO),
  nota: z.string().max(200).nullish(),
})

export interface DanoOrden extends DanoInput {
  id: string
  numero: number
  momento: "recepcion" | "diagnostico"
  createdAt: string
  createdByNombre: string | null
}

export function validarDanosParaTipo(
  danos: DanoInput[],
  codigoTipo: string | null,
): { ok: true } | { ok: false; error: string } {
  if (danos.length > MAX_DANOS_POR_ORDEN) {
    return { ok: false, error: `Máximo ${MAX_DANOS_POR_ORDEN} daños por orden` }
  }
  const esperado = refDiagrama(resolverDiagrama(codigoTipo))
  for (const d of danos) {
    if (d.diagrama !== esperado) {
      return { ok: false, error: "El diagrama no corresponde al tipo de equipo de la orden" }
    }
    const diagrama = diagramaPorRef(d.diagrama)
    if (!diagrama.vistas.some((v) => v.id === d.vista)) {
      return { ok: false, error: `La vista "${d.vista}" no existe en el diagrama del equipo` }
    }
  }
  return { ok: true }
}

const ERRORES_DANOS: Array<[string, { status: 404 | 409 | 422; error: string }]> = [
  ["DANOS_ORDEN_NO_ENCONTRADA", { status: 404, error: "Orden no encontrada" }],
  ["DANOS_ORDEN_CERRADA", { status: 409, error: "La orden ya está cerrada" }],
  ["DANOS_DIAGNOSTICO_FUERA_DE_VENTANA", { status: 409, error: "Pasaron más de 10 minutos; el daño ya no se puede borrar" }],
  ["DANOS_RECEPCION_YA_REGISTRADA", { status: 409, error: "El estado físico de la recepción ya fue registrado" }],
  ["DANOS_RECEPCION_FUERA_DE_VENTANA", { status: 409, error: "La recepción ya no admite registrar el estado físico" }],
  ["DANOS_RECEPCION_INMUTABLE", { status: 409, error: "Los daños de la recepción no se pueden modificar ni borrar" }],
  ["DANOS_SIN_DANOS_CON_PINS", { status: 409, error: 'No se puede marcar "sin daños" si hay daños marcados' }],
  ["DANOS_LIMITE", { status: 422, error: `Máximo ${MAX_DANOS_POR_ORDEN} daños por orden` }],
]

export function mensajeErrorDanos(err: unknown): { status: 404 | 409 | 422 | 500; error: string } {
  const message =
    err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string"
      ? (err as { message: string }).message
      : ""
  for (const [token, res] of ERRORES_DANOS) {
    if (message.includes(token)) return res
  }
  return { status: 500, error: "No se pudo guardar el estado físico" }
}
