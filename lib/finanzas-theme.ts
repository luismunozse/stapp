/**
 * Lenguaje visual compartido de la sección Finanzas.
 * Fuente única de color (para gráficos), tono (para StatCard) y label
 * por concepto, para que "Ingresos" (etc.) se vea igual en todas las vistas.
 */

export type FinanzasConceptKey = "ingresos" | "costos" | "gastos" | "ganancia"

export interface FinanzasConcept {
  label: string
  /** Color hex para recharts (barras, líneas, celdas). */
  color: string
  /** Tono semántico para <StatCard tone>. */
  tone: "success" | "warning" | "danger" | "info"
}

export const FINANZAS_CONCEPTS: Record<FinanzasConceptKey, FinanzasConcept> = {
  // Dinero que entra → verde
  ingresos: { label: "Ingresos", color: "#22c55e", tone: "success" },
  // Costo de lo vendido → naranja
  costos: { label: "Costos", color: "#f97316", tone: "warning" },
  // Gasto operativo → rojo
  gastos: { label: "Gastos", color: "#ef4444", tone: "danger" },
  // Resultado → azul (la ganancia neta puede virar a rojo si es negativa)
  ganancia: { label: "Ganancia", color: "#3b82f6", tone: "info" },
}

export const conceptColor = (k: FinanzasConceptKey) => FINANZAS_CONCEPTS[k].color
export const conceptTone = (k: FinanzasConceptKey) => FINANZAS_CONCEPTS[k].tone
