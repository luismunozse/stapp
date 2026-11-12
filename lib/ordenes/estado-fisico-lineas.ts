import { TIPO_DANO_META, type DanoOrden } from "@/lib/ordenes/danos"

// Módulo puro (sin pdf-lib ni fs): lo usan el PDF, el ticket térmico y los componentes del navegador.

export interface EstadoFisicoPDF {
  diagrama: string
  sinDanos: boolean
  danos: Pick<DanoOrden, "numero" | "vista" | "x" | "y" | "tipo" | "nota" | "momento">[]
}

export const TEXTO_SIN_DANOS = "Sin daños visibles al ingreso"

/** True si hay algo para imprimir: pins o la marca "sin daños". */
export function hayEstadoFisico(e: EstadoFisicoPDF | null | undefined): e is EstadoFisicoPDF {
  return !!e && (e.sinDanos || e.danos.length > 0)
}

/** "1. Golpe (frente) – nota" por cada pin del momento pedido; con "sin daños" y sin pins de recepción, una sola línea. */
export function lineasEstadoFisico(e: EstadoFisicoPDF, momento: "recepcion" | "diagnostico"): string[] {
  const pins = e.danos.filter((d) => d.momento === momento).sort((a, b) => a.numero - b.numero)
  if (momento === "recepcion" && pins.length === 0 && e.sinDanos) return [TEXTO_SIN_DANOS]
  return pins.map((d) => {
    const nota = d.nota?.replace(/\s+/g, " ").trim()
    return `${d.numero}. ${TIPO_DANO_META[d.tipo]?.label ?? d.tipo} (${d.vista})${nota ? ` – ${nota}` : ""}`
  })
}
