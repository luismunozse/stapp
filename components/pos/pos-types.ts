export type TipoDescuento = "MONTO" | "PORCENTAJE"

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

export interface DescuentoConfig {
  tipo: TipoDescuento
  valor: number
}

export interface VentaTotales {
  subtotal: number // bruto (Σ cantidad×precio)
  descuentoItems: number
  descuentoGlobal: number
  descuentoTotal: number
  total: number
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * Calcula los totales de la venta. ESPEJA exactamente la matemática del
 * backend (app/api/ventas/route.ts) para que el total mostrado == el cobrado:
 * descuento por línea reduce el neto; el descuento global (%) se aplica sobre
 * ese neto; total = bruto − descuentoItems − descuentoGlobal (clampeado ≥ 0).
 */
export function computeVentaTotals(
  items: PosCartItem[],
  global?: DescuentoConfig | null
): VentaTotales {
  let subtotalBruto = 0
  let descuentoItems = 0
  for (const it of items) {
    const lineaBruto = it.cantidad * it.precioUnitario
    subtotalBruto += lineaBruto
    const lineaDesc =
      it.tipoDescuento === "PORCENTAJE"
        ? lineaBruto * ((it.porcentajeDescuento || 0) / 100)
        : Math.min(it.descuento || 0, lineaBruto)
    descuentoItems += lineaDesc
  }
  const subtotalNeto = subtotalBruto - descuentoItems

  let descuentoGlobal = 0
  if (global && global.valor > 0) {
    descuentoGlobal =
      global.tipo === "PORCENTAJE"
        ? subtotalNeto * (global.valor / 100)
        : global.valor
  }
  descuentoGlobal = Math.min(Math.max(descuentoGlobal, 0), subtotalNeto)

  return {
    subtotal: round2(subtotalBruto),
    descuentoItems: round2(descuentoItems),
    descuentoGlobal: round2(descuentoGlobal),
    descuentoTotal: round2(descuentoItems + descuentoGlobal),
    total: round2(Math.max(subtotalBruto - descuentoItems - descuentoGlobal, 0)),
  }
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
}

export interface InventarioResult {
  id: string
  codigo: string
  nombre: string
  stock: number
  precioVenta: number
  trackeaSeries?: boolean
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
