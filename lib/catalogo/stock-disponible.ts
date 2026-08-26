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
 *
 * Esta es la ÚNICA lectura permitida de `inventario.stock` en el repo; el resto
 * pasa por acá. Lo fija un guard de fuente en
 * `__tests__/api/catalogo-stock-reservado.test.ts`, porque cuando el cálculo
 * estaba copiado inline se migraron unos lugares y otros no, y el catálogo
 * terminó ofreciendo stock que el checkout después rechazaba.
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
