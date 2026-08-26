/**
 * Disponibilidad que ve el comprador en el catálogo público.
 *
 * Fuente única por item (regla de la migración 239): si el item está linkeado
 * a `inventario`, inventario manda y `catalogo_items.stock` se ignora aunque
 * tenga un valor viejo. Sin link, manda la columna del catálogo.
 *
 * Sobre inventario la disponibilidad es `stock - stock_reservado`, no `stock`
 * a secas: las unidades reservadas por una cotización aprobada o por una
 * solicitud del catálogo ya están comprometidas y ofrecerlas de nuevo termina
 * en sobreventa.
 *
 * `null` significa "sin límite declarado" (el item no lleva control de stock)
 * y se propaga tal cual: los consumidores tratan `null` distinto de `0`.
 */

export type ItemConStock = {
  stock?: number | null
  inventario_id?: string | null
  inventario?: { stock?: number | null; stock_reservado?: number | null } | null
}

export function stockDisponibleCatalogo(item: ItemConStock): number | null {
  if (item.inventario_id && item.inventario) {
    const stock = item.inventario.stock
    if (stock == null) return null
    const reservado = item.inventario.stock_reservado ?? 0
    return Math.max(0, stock - reservado)
  }
  return item.stock ?? null
}

/**
 * Fragmento del embed PostgREST para los SELECT del catálogo público.
 * Centralizado para que ninguna consulta se olvide de `stock_reservado`:
 * sin esa columna el cálculo de arriba lee `undefined`, lo toma como 0 y
 * vuelve en silencio a mostrar stock crudo.
 */
export const INVENTARIO_STOCK_EMBED = "inventario:inventario(stock, stock_reservado)"
