import { round2 } from "@/lib/precios"
import type { CommissionBaseKind } from "@/lib/commissions/types"

export interface BreakdownInput {
  tipo: string
  pagado: boolean
  baseTipo: CommissionBaseKind | null | undefined
  /** Final cost of the order (`costo_final`). */
  documentoTotal: number | null | undefined
  /** Order amount after discounts and credit notes (the definition's `documento_monto`). */
  documentoMonto: number | null | undefined
  documentoCostoRepuestos: number | null | undefined
}

export interface BreakdownLine {
  key: "costoFinal" | "descuentos" | "repuestos"
  label: string
  shortLabel: string
  amount: number
  /** Lines that reduce the amount are shown with a leading minus. */
  subtracts: boolean
}

/**
 * Display-only lines that explain how an unpaid original order row reaches its base.
 * Paid rows, adjustments and rows without a base kind return no lines: only the frozen
 * base is shown for them. The amounts are document figures, not commission math.
 */
export function orderBaseBreakdown(row: BreakdownInput): BreakdownLine[] {
  if (row.pagado || row.tipo !== "ORIGINAL" || !row.baseTipo) return []
  const lines: BreakdownLine[] = [
    { key: "costoFinal", label: "Costo final", shortLabel: "Costo final", amount: row.documentoTotal ?? 0, subtracts: false },
  ]
  if (row.documentoTotal != null && row.documentoMonto != null) {
    const descuentos = round2(row.documentoTotal - row.documentoMonto)
    if (descuentos > 0) {
      lines.push({ key: "descuentos", label: "Descuentos y notas de crédito", shortLabel: "Desc./NC", amount: descuentos, subtracts: true })
    }
  }
  if (row.baseTipo === "MANO_DE_OBRA") {
    lines.push({ key: "repuestos", label: "Repuestos", shortLabel: "Repuestos", amount: row.documentoCostoRepuestos ?? 0, subtracts: true })
  }
  return lines
}
