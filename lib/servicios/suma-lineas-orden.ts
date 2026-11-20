import { precioVentaRepuesto } from "@/lib/db-utils"

/**
 * Lo que suman las líneas de una orden: servicios + repuestos a precio de VENTA
 * (con el costo como respaldo en filas previas a la migración 286).
 *
 * Es el número que sigue el monto vivo de la orden (presupuesto o costo_final)
 * y el que escribe "Aplicar al total".
 *
 * ESPEJO de suma_lineas_orden en supabase/migrations/419_repuestos_suman_al_total.sql:
 * cualquier cambio acá DEBE aplicarse también allá.
 */
export function sumaLineasOrden(input: {
  servicios?: Array<{ cantidad: number; precioUnitario: number | string }> | null
  repuestos?: Array<{
    cantidad: number
    precioVentaUnitario?: number | string | null
    precioUnitario?: number | string | null
  }> | null
}): { servicios: number; repuestos: number; total: number } {
  const servicios = (input.servicios || []).reduce(
    (sum, s) => sum + s.cantidad * (Number(s.precioUnitario) || 0),
    0
  )
  const repuestos = (input.repuestos || []).reduce(
    (sum, r) => sum + r.cantidad * (precioVentaRepuesto(r) ?? 0),
    0
  )
  const redondear = (n: number) => Math.round(n * 100) / 100
  return {
    servicios: redondear(servicios),
    repuestos: redondear(repuestos),
    total: redondear(servicios + repuestos),
  }
}
