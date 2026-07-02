/**
 * Lenguaje visual compartido de la sección Finanzas.
 * Fuente única de color (para gráficos) y tono (para StatCard) por concepto,
 * para que "Ingresos" (etc.) se vea igual en todas las vistas.
 */

export type FinanzasConceptKey = "ingresos" | "costos" | "gastos" | "ganancia"

export interface FinanzasConcept {
  /** Color hex para recharts (barras, líneas, celdas). */
  color: string
  /** Tono semántico para <StatCard tone>. */
  tone: "success" | "warning" | "danger" | "info"
}

export const FINANZAS_CONCEPTS: Record<FinanzasConceptKey, FinanzasConcept> = {
  // Dinero que entra → verde
  ingresos: { color: "#22c55e", tone: "success" },
  // Costo de lo vendido → naranja
  costos: { color: "#f97316", tone: "warning" },
  // Gasto operativo → rojo
  gastos: { color: "#ef4444", tone: "danger" },
  // Resultado → azul (la ganancia neta puede virar a rojo si es negativa)
  ganancia: { color: "#3b82f6", tone: "info" },
}
