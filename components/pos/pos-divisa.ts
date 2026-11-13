/**
 * POS helpers for lines priced in a foreign currency. Pure: the terminal owns the state and calls
 * these. The local unit price of such a line is always derived from `precioOrigen` and the rate in
 * use in the cart (`tcCarrito`), with the same function the server uses (convertirALocal).
 */
import { CURRENCIES } from "@/lib/currency"
import { aplicarCotizacionLineas, mensajeNoVendible, motivoNoVendible, type MotivoNoVendible } from "@/lib/currency/venta-divisa"
import type { ConfigMoneda } from "@/lib/currency/config-moneda"
import type { ResultadoTipoCambio } from "@/lib/currency/tipo-cambio"
import type { PosCartItem } from "./pos-types"

/** "US$ 10", "US$ 10,50", "€ 8": the symbol keeps a foreign amount from reading as pesos. */
export function formatDivisa(monto: number, moneda: "USD" | "EUR"): string {
  const decimales = Number.isInteger(monto) ? 0 : 2
  const numero = monto.toLocaleString("es-AR", { minimumFractionDigits: decimales, maximumFractionDigits: 2 })
  return `${CURRENCIES[moneda].symbol} ${numero}`
}

/** Short reason for a search card or variant row that cannot be sold. */
export function motivoCorto(motivo: MotivoNoVendible, moneda: "USD" | "EUR"): string {
  switch (motivo) {
    case "DESHABILITADA":
      return "Moneda extranjera deshabilitada"
    case "OTRA_DIVISA":
      return `${moneda} ya no es la divisa de la organización`
    case "SIN_COTIZACION":
      return `Sin cotización de ${moneda}`
  }
}

/**
 * A recalled held sale: its foreign lines are converted again at `tc` and the ones that can no
 * longer be sold are dropped, with one message each. Local lines are untouched.
 */
export function reconvertirApartada(
  items: PosCartItem[],
  config: ConfigMoneda | null | undefined,
  tipoCambio: ResultadoTipoCambio | null | undefined,
  tc: number | null,
  unidad: number
): { items: PosCartItem[]; avisos: string[] } {
  const avisos: string[] = []
  const vendibles = items.filter((item) => {
    if (!item.moneda) return true
    const motivo = motivoNoVendible(item.moneda, config, tipoCambio)
    if (motivo === null && tc !== null) return true
    avisos.push(mensajeNoVendible(motivo ?? "SIN_COTIZACION", item.nombre, item.moneda))
    return false
  })
  return { items: tc === null ? vendibles : aplicarCotizacionLineas(vendibles, tc, unidad), avisos }
}
