import { CURRENCIES } from "@/lib/currency"

/**
 * A foreign amount with its symbol, es-AR digits: "US$ 10", "US$ 10,50", "€ 12,50". The symbol
 * keeps a foreign price from reading as pesos (Intl's en-US USD format is a bare "$10.00").
 */
export function formatDivisa(monto: number, moneda: "USD" | "EUR"): string {
  const decimales = Number.isInteger(monto) ? 0 : 2
  const numero = monto.toLocaleString("es-AR", { minimumFractionDigits: decimales, maximumFractionDigits: 2 })
  return `${CURRENCIES[moneda].symbol} ${numero}`
}
