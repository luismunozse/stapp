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
