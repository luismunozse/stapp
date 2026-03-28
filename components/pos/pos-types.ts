export interface PosCartItem {
  lineId: string
  inventarioId: string | null
  codigo: string
  nombre: string
  precioUnitario: number
  cantidad: number
  stockDisponible: number
  diasGarantia: number
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
}

export const EMPTY_CLIENT: PosCliente = { id: null, nombre: "", telefono: "" }

let _lineId = 0
export function nextLineId(): string {
  return `pos_${++_lineId}_${Date.now()}`
}
