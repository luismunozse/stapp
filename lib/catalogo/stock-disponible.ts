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
  inventario?: {
    stock?: number | null
    stock_reservado?: number | null
    deleted_at?: string | null
  } | null
}

/**
 * Un producto borrado en soft no se puede vender: `reservar_stock_catalogo`
 * filtra `deleted_at IS NULL` y levanta P0002 si el link apunta a uno.
 * El storefront tiene que decir lo mismo — si lo sigue ofreciendo, el comprador
 * se entera recién al confirmar y con el carrito entero rechazado.
 */
function inventarioVivo(inv: NonNullable<ItemConStock["inventario"]>): boolean {
  return inv.deleted_at == null
}

/**
 * Stock FÍSICO del ítem: lo que hay en el estante, sin descontar reservas.
 *
 * Es lo que corresponde mostrar en las pantallas de administración, donde el
 * dueño necesita el número real y no la disponibilidad pública. Existe como
 * función con nombre —y no como ternario suelto— para que las dos preguntas
 * queden separadas y ninguna se confunda con la otra: mezclarlas fue el bug
 * original del catálogo.
 */
export function stockFisicoCatalogo(item: ItemConStock): number | null {
  if (item.inventario_id) {
    // Link roto (producto borrado, o apuntando a una fila que ya no está):
    // `null`, no el valor viejo de catalogo_items.stock. La migración 239
    // declaró esa columna sin sentido cuando hay link, así que mostrarla —y
    // encima etiquetada "(inv.)"— sería inventar un número. Es el mismo caso
    // que /api/catalogo/diagnose reporta como `roto`.
    return item.inventario?.stock ?? null
  }
  return item.stock ?? null
}

/** Unidades comprometidas por cotizaciones sin cerrar. 0 si no hay link. */
export function stockReservadoCatalogo(item: ItemConStock): number {
  if (item.inventario_id && item.inventario) {
    return item.inventario.stock_reservado ?? 0
  }
  return 0
}

export function stockDisponibleCatalogo(item: ItemConStock): number | null {
  if (item.inventario_id && item.inventario) {
    // Producto borrado: 0 disponible, no "sin límite". Es lo mismo que va a
    // contestar el RPC al confirmar el pedido.
    if (!inventarioVivo(item.inventario)) return 0
    const stock = item.inventario.stock
    if (stock == null) return null
    const reservado = item.inventario.stock_reservado ?? 0
    return Math.max(0, stock - reservado)
  }
  return item.stock ?? null
}
