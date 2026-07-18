/**
 * Cálculo del monto a reembolsar en una devolución de venta.
 *
 * Regla de negocio: se reembolsa EXACTAMENTE lo que el cliente pagó por las
 * unidades devueltas — nunca el precio bruto. Para eso se toma la porción
 * proporcional de `venta.total` correspondiente al neto (post descuento de
 * línea) de las unidades devueltas. Al escalar sobre `venta.total`, el
 * descuento global y el IVA quedan plegados de forma proporcional.
 *
 * Espeja la lógica del RPC `registrar_devolucion_atomica` (migración 272):
 * cualquier cambio de fórmula debe replicarse en ambos lados.
 */

export interface RefundSaleItem {
  id: string
  cantidad: number | string
  precio_unitario: number | string
  descuento?: number | string | null
  tipo_descuento?: string | null
  porcentaje_descuento?: number | string | null
}

export interface RefundReturnLine {
  itemVentaId: string
  cantidad: number
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""))
  return Number.isFinite(n) ? n : 0
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

/** Neto total de la venta = Σ (neto de línea) sobre todas las líneas. */
export function saleNetTotal(items: RefundSaleItem[]): number {
  return items.reduce((sum, it) => sum + effectiveUnitNet(it) * num(it.cantidad), 0)
}

/**
 * Precio efectivamente pagado por unidad: neto de línea escalado por
 * `ventaTotal / netoTotal`, de modo que pliega el descuento global y el IVA.
 * Sirve para guardar `items_devolucion` de forma que sus subtotales reconcilien
 * con `monto_devolucion`.
 */
export function effectivePaidUnitPrice(
  item: RefundSaleItem,
  ventaTotal: number | string,
  saleNet: number
): number {
  if (saleNet <= 0) return 0
  return effectiveUnitNet(item) * (num(ventaTotal) / saleNet)
}

/** Precio neto por unidad de una línea, descontando el descuento de línea. */
export function effectiveUnitNet(item: RefundSaleItem): number {
  const cantidad = num(item.cantidad)
  const precio = num(item.precio_unitario)
  if (cantidad <= 0) return 0

  const bruto = cantidad * precio
  const esPorcentaje = (item.tipo_descuento ?? "MONTO") === "PORCENTAJE"
  const descuentoLinea = esPorcentaje
    ? bruto * (num(item.porcentaje_descuento) / 100)
    : Math.min(num(item.descuento), bruto)

  const neto = bruto - descuentoLinea
  return neto / cantidad
}

export interface DevolucionMontoOpts {
  /** Suma de `monto_devolucion` de devoluciones previas de esta venta. */
  priorRefunded?: number
  /** True si este batch completa la devolución de toda la venta (tipo TOTAL). */
  isTotal?: boolean
}

/**
 * Monto a reembolsar por las unidades devueltas.
 * @param ventaTotal  `venta.total` (lo efectivamente cobrado, ya con global + IVA).
 * @param items       todos los `items_venta` de la venta.
 * @param returned    líneas + cantidad que se devuelven en ESTA devolución.
 * @param opts        cap/true-up contra lo ya devuelto (devoluciones secuenciales).
 *
 * Invariante: la suma de reembolsos de una venta nunca supera `venta.total`, y en
 * la devolución TOTAL cierra exactamente en el remanente (sin drift de centavos).
 */
export function computeDevolucionMonto(
  ventaTotal: number | string,
  items: RefundSaleItem[],
  returned: RefundReturnLine[],
  opts: DevolucionMontoOpts = {}
): number {
  const total = num(ventaTotal)
  const remaining = Math.max(0, round2(total - num(opts.priorRefunded)))

  // Devolución TOTAL: cierra en el remanente exacto.
  if (opts.isTotal) return remaining

  const byId = new Map(items.map((it) => [it.id, it]))

  // Neto total de la venta (post descuento de línea, pre global/IVA).
  const netoTotal = saleNetTotal(items)
  if (netoTotal <= 0) return 0

  // Neto de las unidades devueltas.
  const netoDevuelto = returned.reduce((sum, r) => {
    const it = byId.get(r.itemVentaId)
    if (!it) return sum
    return sum + effectiveUnitNet(it) * num(r.cantidad)
  }, 0)

  const proporcional = round2(total * (netoDevuelto / netoTotal))
  // Cap: nunca reembolsar más que lo que resta.
  return Math.min(proporcional, remaining)
}
