/**
 * Forma de los reclamos de garantía en las respuestas de la API. La base guarda
 * snake_case; la UI (GarantiaCard) lee camelCase. Antes los reclamos salían
 * crudos y la card leía `fechaReclamo` sobre `fecha_reclamo`: la fecha del
 * reclamo salía vacía y nunca aparecía "Nueva orden de reparación creada".
 * Todas las rutas de garantías pasan por acá.
 */

export interface ReclamoGarantiaApi {
  id: string
  garantiaId: string
  descripcion: string
  estado: string
  ordenReparacionId: string | null
  resolucion: string | null
  fechaReclamo: string
  fechaResolucion: string | null
}

export type ReclamoGarantiaRow = {
  id: string
  garantia_id: string
  descripcion: string
  estado: string
  orden_reparacion_id?: string | null
  resolucion?: string | null
  fecha_reclamo: string
  fecha_resolucion?: string | null
}

export function formatReclamo(r: ReclamoGarantiaRow): ReclamoGarantiaApi {
  return {
    id: r.id,
    garantiaId: r.garantia_id,
    descripcion: r.descripcion,
    estado: r.estado,
    ordenReparacionId: r.orden_reparacion_id ?? null,
    resolucion: r.resolucion ?? null,
    fechaReclamo: r.fecha_reclamo,
    fechaResolucion: r.fecha_resolucion ?? null,
  }
}

/** Reclamos en camelCase, del más reciente al más viejo. */
export function formatReclamos(
  rows: ReclamoGarantiaRow[] | null | undefined
): ReclamoGarantiaApi[] {
  return (rows ?? [])
    .map(formatReclamo)
    .sort((a, b) => new Date(b.fechaReclamo).getTime() - new Date(a.fechaReclamo).getTime())
}
