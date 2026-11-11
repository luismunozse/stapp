/**
 * Forma de los reclamos de garantía en las respuestas de la API. La base guarda
 * snake_case; la UI lee camelCase. Todas las rutas de garantías pasan por acá.
 *
 * Desde la 401 un reclamo puede ser de una garantía de reparación (garantia_id)
 * o de venta (garantia_venta_id), y la orden de re-ingreso vive en
 * orden_reingreso_id (orden_reparacion_id queda como espejo).
 */
import { faseReclamo, type FaseReclamo } from "./reclamo-estado"

export interface ReclamoGarantiaApi {
  id: string
  origen: "REPARACION" | "VENTA"
  garantiaId: string
  descripcion: string
  /** Estado crudo de la base (PENDIENTE, ACEPTADO…). */
  estado: string
  /** Estado del ciclo simplificado: ABIERTO, ACEPTADO, RECHAZADO o RESUELTO. */
  fase: FaseReclamo
  /** Id de la orden de re-ingreso (antes ordenReparacionId; se mantiene el nombre viejo). */
  ordenReparacionId: string | null
  ordenReingreso: { id: string; numero: string | null } | null
  resolucion: string | null
  motivoRechazo: string | null
  vigenciaForzadaMotivo: string | null
  registradoPor: string | null
  decididoPor: string | null
  fechaReclamo: string
  fechaDecision: string | null
  fechaResolucion: string | null
}

export type ReclamoGarantiaRow = {
  id: string
  garantia_id?: string | null
  garantia_venta_id?: string | null
  descripcion: string
  estado: string
  orden_reparacion_id?: string | null
  orden_reingreso_id?: string | null
  resolucion?: string | null
  motivo_rechazo?: string | null
  vigencia_forzada_motivo?: string | null
  registrado_por?: string | null
  decidido_por?: string | null
  fecha_reclamo: string
  fecha_decision?: string | null
  fecha_resolucion?: string | null
}

export interface ExtrasReclamo {
  /** Número visible de cada orden de re-ingreso, por id. */
  numerosOrden?: Map<string, string>
  /** Nombre de cada usuario, por id. */
  nombresUsuario?: Map<string, string>
}

export function formatReclamo(r: ReclamoGarantiaRow, extras: ExtrasReclamo = {}): ReclamoGarantiaApi {
  const ordenId = r.orden_reingreso_id ?? r.orden_reparacion_id ?? null
  const nombre = (id: string | null | undefined) => (id ? extras.nombresUsuario?.get(id) ?? null : null)
  return {
    id: r.id,
    origen: r.garantia_venta_id ? "VENTA" : "REPARACION",
    garantiaId: (r.garantia_id ?? r.garantia_venta_id) as string,
    descripcion: r.descripcion,
    estado: r.estado,
    fase: faseReclamo(r.estado),
    ordenReparacionId: ordenId,
    ordenReingreso: ordenId ? { id: ordenId, numero: extras.numerosOrden?.get(ordenId) ?? null } : null,
    resolucion: r.resolucion ?? null,
    motivoRechazo: r.motivo_rechazo ?? null,
    vigenciaForzadaMotivo: r.vigencia_forzada_motivo ?? null,
    registradoPor: nombre(r.registrado_por),
    decididoPor: nombre(r.decidido_por),
    fechaReclamo: r.fecha_reclamo,
    fechaDecision: r.fecha_decision ?? null,
    fechaResolucion: r.fecha_resolucion ?? null,
  }
}

/** Reclamos en camelCase, del más reciente al más viejo. */
export function formatReclamos(
  rows: ReclamoGarantiaRow[] | null | undefined,
  extras: ExtrasReclamo = {}
): ReclamoGarantiaApi[] {
  return (rows ?? [])
    .map((r) => formatReclamo(r, extras))
    .sort((a, b) => new Date(b.fechaReclamo).getTime() - new Date(a.fechaReclamo).getTime())
}
