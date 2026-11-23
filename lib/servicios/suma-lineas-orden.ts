import { precioVentaRepuesto } from "@/lib/db-utils"

/** Una cotización tal como llega embebida en la orden (snake_case de Postgres). */
export interface CotizacionDeOrden {
  id?: string
  numero_cotizacion?: string | null
  estado?: string | null
  total?: number | string | null
  deleted_at?: string | null
  reemplazada_por?: string | null
}

/** Misma definición que cotizacionesVigentesDeOrden (lib/cotizacion-presupuesto.ts)
 *  y orden_tiene_cotizacion_vigente (migración 421): no borrada, no reemplazada
 *  por una revisión, no rechazada. */
export function cotizacionesVigentes<T extends CotizacionDeOrden>(cotizaciones?: T[] | null): T[] {
  return (cotizaciones || []).filter(
    (c) => !c.deleted_at && !c.reemplazada_por && c.estado !== "RECHAZADA"
  )
}

/**
 * Monto calculado de una orden:
 *   - con alguna cotización vigente: cotizaciones vigentes + servicios y
 *     repuestos que NO están marcados como incluidos en ellas;
 *   - sin cotización vigente: todas las líneas (la marca no tiene efecto).
 * Repuestos a precio de VENTA (con el costo como respaldo en filas previas a
 * la migración 286).
 *
 * Es el número que sigue el monto vivo de la orden (presupuesto o costo_final)
 * y el que escribe "Aplicar al total".
 *
 * ESPEJO de suma_lineas_orden en supabase/migrations/421_presupuesto_y_lineas_suman.sql:
 * cualquier cambio acá DEBE aplicarse también allá.
 */
export function sumaLineasOrden(input: {
  servicios?: Array<{
    cantidad: number
    precioUnitario: number | string
    incluidoEnPresupuesto?: boolean
  }> | null
  repuestos?: Array<{
    cantidad: number
    precioVentaUnitario?: number | string | null
    precioUnitario?: number | string | null
    incluidoEnPresupuesto?: boolean
  }> | null
  cotizaciones?: CotizacionDeOrden[] | null
}): { presupuestos: number; servicios: number; repuestos: number; total: number } {
  const vigentes = cotizacionesVigentes(input.cotizaciones)
  const hayPresupuesto = vigentes.length > 0
  const suma = (l: { incluidoEnPresupuesto?: boolean }) => !(hayPresupuesto && l.incluidoEnPresupuesto)

  const presupuestos = vigentes.reduce((sum, c) => sum + (Number(c.total) || 0), 0)
  const servicios = (input.servicios || [])
    .filter(suma)
    .reduce((sum, s) => sum + s.cantidad * (Number(s.precioUnitario) || 0), 0)
  const repuestos = (input.repuestos || [])
    .filter(suma)
    .reduce((sum, r) => sum + r.cantidad * (precioVentaRepuesto(r) ?? 0), 0)
  const redondear = (n: number) => Math.round(n * 100) / 100
  return {
    presupuestos: redondear(presupuestos),
    servicios: redondear(servicios),
    repuestos: redondear(repuestos),
    total: redondear(presupuestos + servicios + repuestos),
  }
}
