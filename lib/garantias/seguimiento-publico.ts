/**
 * La garantía y su reclamo tal como los ve el CLIENTE en el seguimiento
 * público (/seguimiento/[token]). Sin dependencias de servidor.
 *
 * Lista blanca: el endpoint público solo devuelve lo que arman estas
 * funciones. De la garantía: días, fechas, estado derivado, las condiciones
 * de la entrega (notas, que ya van impresas en el comprobante del cliente) y
 * los términos de la org. Del reclamo: una fase para el cliente, un texto, el
 * motivo del rechazo y el número de la orden de re-ingreso. Nunca salen ids,
 * quién lo registró o lo decidió (registrado_por, decidido_por), el motivo
 * de una vigencia forzada, la resolución interna ni la descripción que cargó
 * el taller.
 */
import { derivarEstadoGarantia, type EstadoGarantia } from "./estado"
import { ESTADOS_RECLAMO_ABIERTO } from "./reclamo-estado"

export type FaseReclamoPublica = "EN_REVISION" | "ACEPTADO" | "RESUELTO" | "RECHAZADO"

export interface ReclamoPublico {
  fase: FaseReclamoPublica
  titulo: string
  detalle: string | null
  /** Cuándo se registró el reclamo. */
  fecha: string | null
  /** Número para mostrar de la orden de re-ingreso ("#1234" o el código). */
  ordenReingreso: string | null
}

export interface GarantiaPublica {
  diasValidez: number
  fechaInicio: string | null
  fechaVencimiento: string
  estado: EstadoGarantia
  /** Días que le quedan (0 si ya venció). */
  diasRestantes: number
  notas: string | null
  terminos: string | null
  reclamo: ReclamoPublico | null
}

/** Columnas que el endpoint lee de reclamos_garantia: ninguna interna de más. */
export const COLUMNAS_RECLAMO_PUBLICO = "estado, motivo_rechazo, fecha_reclamo, orden_reingreso_id"

export interface FilaReclamoPublico {
  estado: string | null
  motivo_rechazo: string | null
  fecha_reclamo: string | null
  orden_reingreso_id: string | null
}

export interface FilaGarantiaPublica {
  dias_validez: number | null
  fecha_inicio: string | null
  fecha_vencimiento: string
  estado: string | null
  notas: string | null
}

/** El reclamo a mostrar: el abierto si hay; si no, el último cerrado. */
export function elegirReclamoPublico<T extends FilaReclamoPublico>(reclamos: T[]): T | null {
  if (reclamos.length === 0) return null
  const porFecha = [...reclamos].sort((a, b) => (b.fecha_reclamo ?? "").localeCompare(a.fecha_reclamo ?? ""))
  return porFecha.find((r) => (ESTADOS_RECLAMO_ABIERTO as readonly string[]).includes(r.estado ?? "")) ?? porFecha[0]
}

export function numeroOrdenPublico(o: { numero_orden: number | null; codigo_orden: string | null } | null): string | null {
  if (!o) return null
  if (o.codigo_orden) return o.codigo_orden
  return o.numero_orden != null ? `#${o.numero_orden}` : null
}

export function reclamoPublico(r: FilaReclamoPublico, ordenReingreso: string | null): ReclamoPublico {
  const fecha = r.fecha_reclamo ?? null
  switch (r.estado) {
    case "ACEPTADO":
      return {
        fase: "ACEPTADO",
        titulo: ordenReingreso
          ? `Aceptado: tu equipo reingresó como orden ${ordenReingreso}`
          : "Aceptado: tu equipo reingresó por garantía",
        detalle: "Lo estamos revisando sin costo. Te avisamos cuando esté listo.",
        fecha,
        ordenReingreso,
      }
    case "RESUELTO":
      return {
        fase: "RESUELTO",
        titulo: "Resuelto: tu reclamo de garantía ya se cerró",
        detalle: ordenReingreso ? `La revisión por garantía se hizo en la orden ${ordenReingreso}.` : null,
        fecha,
        ordenReingreso,
      }
    case "RECHAZADO": {
      const motivo = r.motivo_rechazo?.trim() || null
      return {
        fase: "RECHAZADO",
        titulo: motivo ? `Rechazado: ${motivo}` : "Rechazado: tu reclamo de garantía no fue aceptado",
        detalle: "Si tenés dudas, escribinos o acercate al local.",
        fecha,
        ordenReingreso: null,
      }
    }
    default:
      return {
        fase: "EN_REVISION",
        titulo: "Tu reclamo de garantía está en revisión",
        detalle: "Te avisamos cuando tengamos una respuesta.",
        fecha,
        ordenReingreso: null,
      }
  }
}

export function armarGarantiaPublica(
  g: FilaGarantiaPublica,
  ctx: {
    hoy: string
    diaVencimiento: string
    ventana: number
    terminos: string | null
    reclamo: FilaReclamoPublico | null
    ordenReingreso: string | null
  }
): GarantiaPublica {
  const reclamoAbierto =
    !!ctx.reclamo && (ESTADOS_RECLAMO_ABIERTO as readonly string[]).includes(ctx.reclamo.estado ?? "")
  const { estado, diasRestantes } = derivarEstadoGarantia({
    anulada: g.estado === "ANULADA",
    reclamoAbierto,
    diaVencimiento: ctx.diaVencimiento,
    hoy: ctx.hoy,
    ventana: ctx.ventana,
  })
  return {
    diasValidez: g.dias_validez ?? 0,
    fechaInicio: g.fecha_inicio,
    fechaVencimiento: g.fecha_vencimiento,
    estado,
    diasRestantes: Math.max(0, diasRestantes),
    notas: g.notas?.trim() || null,
    terminos: ctx.terminos,
    reclamo: ctx.reclamo ? reclamoPublico(ctx.reclamo, ctx.ordenReingreso) : null,
  }
}
