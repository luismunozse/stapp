import {
  calcularTotalesVenta,
  type DescuentoConfig,
  type FiscalConfig,
  type TipoDescuento,
  type VentaTotales,
} from "@/lib/ventas/totales"

export type { TipoDescuento, DescuentoConfig, IvaRegimen, FiscalConfig, VentaTotales } from "@/lib/ventas/totales"

export interface PosCartItem {
  lineId: string
  inventarioId: string | null
  codigo: string
  nombre: string
  precioUnitario: number
  cantidad: number
  stockDisponible: number
  diasGarantia: number
  trackeaSeries: boolean
  serieIds: string[]
  costo?: number
  // Descuento por línea (opcional; ausente = sin descuento). MONTO = `descuento`
  // ($ off de la línea); PORCENTAJE = `porcentajeDescuento` (% sobre el bruto).
  tipoDescuento?: TipoDescuento
  descuento?: number
  porcentajeDescuento?: number
}

/**
 * Totales de la venta con la misma función que usa POST /api/ventas
 * (lib/ventas/totales.ts), así el total que ve el cajero es el que valida el
 * servidor. `factor` es el recargo del método de pago (1 = precio de lista).
 */
export function computeVentaTotals(
  items: PosCartItem[],
  global?: DescuentoConfig | null,
  fiscal?: FiscalConfig | null,
  roundCash = false,
  factor = 1
): VentaTotales {
  return calcularTotalesVenta(items, global, fiscal, roundCash, factor)
}

export interface PosCliente {
  id: string | null
  nombre: string
  telefono: string
}

export interface HeldSale {
  id: string
  timestamp: number
  cliente: PosCliente
  items: PosCartItem[]
  nota: string
  /** Descuento sobre el total (antes se perdía al apartar). */
  descuentoGlobal?: DescuentoConfig | null
  descuentoMotivo?: string
}

export interface InventarioResult {
  id: string
  codigo: string
  nombre: string
  stock: number
  precioVenta: number
  trackeaSeries?: boolean
  diasGarantiaDefault?: number | null
}

/**
 * Resolves the warranty days for a cart item using a product > org > 0 cascade.
 * - `productDefault`: the item-level override (dias_garantia_default from inventario).
 * - `orgDefault`: the organization-level default (garantia_dias_default from organizations).
 * Resolution: productDefault wins if it is a finite integer >= 0.
 *             0 IS a valid explicit value (explicit "no warranty"). Negative, NaN,
 *             null and undefined are treated as "not set" and fall through.
 */
export function resolveDiasGarantia(
  productDefault?: number | null,
  orgDefault?: number | null
): number {
  if (productDefault != null && Number.isFinite(productDefault) && productDefault >= 0) {
    return productDefault
  }
  if (orgDefault != null && Number.isFinite(orgDefault) && orgDefault >= 0) {
    return orgDefault
  }
  return 0
}

export interface SerieDisponible {
  id: string
  numeroSerie: string
}

// FIFO: la lista llega ya ordenada por created_at asc desde la API.
// Toma las primeras N. Si N excede, devuelve todas las disponibles.
export function autoSelectSeries(series: SerieDisponible[], cantidad: number): string[] {
  if (cantidad <= 0) return []
  return series.slice(0, cantidad).map((s) => s.id)
}

export const EMPTY_CLIENT: PosCliente = { id: null, nombre: "", telefono: "" }

let _lineId = 0
export function nextLineId(): string {
  return `pos_${++_lineId}_${Date.now()}`
}
