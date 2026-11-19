import { toArray } from "@/lib/db-utils"

/**
 * El remito vigente de una orden: el que no está ANULADA. Desde la migración
 * 418 una orden puede tener remitos anulados más uno vigente, y el embed
 * `facturas (...)` desde ordenes_servicio llega como lista (antes, por el
 * UNIQUE, como objeto o null: toArray acepta las dos formas).
 */
export function remitoActivo<T extends { estado_pago?: string | null }>(
  facturas: T | T[] | null | undefined,
): T | null {
  return toArray(facturas).find((f) => f.estado_pago !== "ANULADA") ?? null
}
