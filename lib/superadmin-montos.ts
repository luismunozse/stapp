import { CURRENCIES, formatCurrencyValue, type CurrencyCode } from "@/lib/currency"

/**
 * Un monto del panel superadmin, separado por moneda. Los pagos pueden venir en
 * ARS o USD (según el proveedor): sumarlos en un solo número no tiene sentido.
 */
export interface MontoPorMoneda {
  moneda: string
  total: number
  cantidad?: number
}

/** Filas de `superadmin_pagos_por_moneda` → montos; ARS primero, el resto por código. */
export function montosDesdeRpc(
  filas: ReadonlyArray<{ moneda: string; total: number | string; cantidad?: number | string }> | null
): MontoPorMoneda[] {
  return (filas ?? [])
    .map((f) => ({
      moneda: f.moneda,
      total: Number(f.total) || 0,
      ...(f.cantidad !== undefined ? { cantidad: Number(f.cantidad) || 0 } : {}),
    }))
    .sort((a, b) => (a.moneda === "ARS" ? -1 : b.moneda === "ARS" ? 1 : a.moneda.localeCompare(b.moneda)))
}

export function formatMonto(total: number, moneda: string): string {
  if (moneda in CURRENCIES) return formatCurrencyValue(total, moneda as CurrencyCode)
  return `${moneda} ${total.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** "$ 1.000,00 · US$50.00"; sin montos, "$ 0,00". */
export function formatMontosPorMoneda(montos: readonly MontoPorMoneda[] | null | undefined): string {
  const conMonto = (montos ?? []).filter((m) => m.total !== 0)
  if (conMonto.length === 0) return formatCurrencyValue(0)
  return conMonto.map((m) => formatMonto(m.total, m.moneda)).join(" · ")
}
