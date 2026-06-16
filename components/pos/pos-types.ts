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

export type IvaRegimen = "EXENTO" | "INCLUIDO" | "ADITIVO"

export interface FiscalConfig {
  regimen: IvaRegimen
  tasa: number // p.ej. 21
  /** Unidad de redondeo de efectivo (0 = sin redondeo). */
  redondeoEfectivo: number
}

export interface VentaTotales {
  subtotal: number // bruto (Σ cantidad×precio)
  descuentoItems: number
  descuentoGlobal: number
  descuentoTotal: number
  /** Base post-descuento, pre-IVA y pre-redondeo (= subtotal − descuentoTotal). */
  base: number
  /** Neto sin IVA. EXENTO/ADITIVO: = base. INCLUIDO: base/(1+tasa). */
  neto: number
  iva: number
  /** Ajuste por redondeo de efectivo (0 si no aplica). */
  redondeo: number
  /** Total final cobrado (con IVA aditivo + redondeo aplicados). */
  total: number
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * Calcula los totales de la venta. ESPEJA exactamente la matemática del backend
 * (app/api/ventas/route.ts) para que el total mostrado == el cobrado.
 * - descuento por línea reduce el neto; el descuento global se aplica sobre ese
 *   neto; base = bruto − descuentos (clampeado ≥ 0).
 * - IVA por régimen: EXENTO (iva 0, total=base); INCLUIDO (el precio ya incluye
 *   IVA → neto=base/(1+t), iva=base−neto, total=base); ADITIVO (neto=base,
 *   iva=base×t, total=base+iva).
 * - redondeo de efectivo: solo si `roundCash` y redondeoEfectivo>0 → redondea el
 *   total al múltiplo más cercano.
 */
export function computeVentaTotals(
  items: PosCartItem[],
  global?: DescuentoConfig | null,
  fiscal?: FiscalConfig | null,
  roundCash = false
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

  const base = Math.max(subtotalBruto - descuentoItems - descuentoGlobal, 0)

  const regimen = fiscal?.regimen ?? "EXENTO"
  const tasa = fiscal?.tasa ?? 0
  let neto = base
  let iva = 0
  let totalPreRound = base
  if (regimen === "INCLUIDO" && tasa > 0) {
    neto = base / (1 + tasa / 100)
    iva = base - neto
    totalPreRound = base
  } else if (regimen === "ADITIVO" && tasa > 0) {
    neto = base
    iva = base * (tasa / 100)
    totalPreRound = base + iva
  }

  let redondeo = 0
  let total = totalPreRound
  const unidad = fiscal?.redondeoEfectivo ?? 0
  if (roundCash && unidad > 0) {
    const rounded = Math.round(totalPreRound / unidad) * unidad
    redondeo = rounded - totalPreRound
    total = rounded
  }

  return {
    subtotal: round2(subtotalBruto),
    descuentoItems: round2(descuentoItems),
    descuentoGlobal: round2(descuentoGlobal),
    descuentoTotal: round2(descuentoItems + descuentoGlobal),
    base: round2(base),
    neto: round2(neto),
    iva: round2(iva),
    redondeo: round2(redondeo),
    total: round2(total),
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
