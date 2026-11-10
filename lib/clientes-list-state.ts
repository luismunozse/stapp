export interface ClientesFilters {
  search: string
  tipoCliente: string
  conDeuda: boolean
  aceptaWhatsapp: string
  fechaDesde: string
  fechaHasta: string
}

export const EMPTY_FILTERS: ClientesFilters = {
  search: "",
  tipoCliente: "",
  conDeuda: false,
  aceptaWhatsapp: "",
  fechaDesde: "",
  fechaHasta: "",
}

export function hasActiveFilters(f: ClientesFilters): boolean {
  return Boolean(
    f.search.trim() || f.tipoCliente || f.conDeuda || f.aceptaWhatsapp || f.fechaDesde || f.fechaHasta
  )
}

export interface BalanceChip {
  kind: "debe" | "favor"
  label: "Debe" | "A favor"
  amount: number
}

// Debt wins over credit: it is the actionable one at the counter.
export function clienteBalanceChip(c: { deudaPendiente?: number; saldoCuenta?: number }): BalanceChip | null {
  const deuda = c.deudaPendiente ?? 0
  if (deuda > 0) return { kind: "debe", label: "Debe", amount: deuda }
  const saldo = c.saldoCuenta ?? 0
  if (saldo > 0) return { kind: "favor", label: "A favor", amount: saldo }
  return null
}
