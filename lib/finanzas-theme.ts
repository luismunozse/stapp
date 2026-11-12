/**
 * Lenguaje visual compartido de la sección Finanzas.
 * Fuente única de color (para gráficos) y tono (para StatCard) por concepto,
 * para que "Ingresos" (etc.) se vea igual en todas las vistas.
 */

import { CHART_CONCEPT_COLORS } from "@/lib/chart-colors"

export type FinanzasConceptKey = "ingresos" | "costos" | "gastos" | "ganancia"

export interface FinanzasConcept {
  /** Color para recharts (token `--chart-*`, cambia con el tema). */
  color: string
  /** Tono semántico para <StatCard tone>. */
  tone: "success" | "warning" | "danger" | "info"
}

export const FINANZAS_CONCEPTS: Record<FinanzasConceptKey, FinanzasConcept> = {
  // Dinero que entra → verde
  ingresos: { color: CHART_CONCEPT_COLORS.ingresos, tone: "success" },
  // Costo de lo vendido → naranja
  costos: { color: CHART_CONCEPT_COLORS.costos, tone: "warning" },
  // Gasto operativo → rojo
  gastos: { color: CHART_CONCEPT_COLORS.gastos, tone: "danger" },
  // Resultado → azul (la ganancia neta puede virar a rojo si es negativa)
  ganancia: { color: CHART_CONCEPT_COLORS.ganancia, tone: "info" },
}
