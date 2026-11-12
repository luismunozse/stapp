/**
 * Colores de gráficos (recharts) desde los tokens `--chart-*` de
 * app/globals.css, que tienen valor propio en modo claro y oscuro. Nada de hex
 * sueltos en los componentes: así un mismo concepto (p. ej. "Costos") se ve
 * igual en reportes, finanzas y dashboard.
 *
 * Los estados de orden tienen su propio color en lib/estado-orden-ui.ts.
 */

/** Series categóricas, en el orden en que conviene usarlas. */
export const CHART_SERIES = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `hsl(var(--chart-${n}))`)

/** Color de la serie `index` (da la vuelta si hay más de 8). */
export function chartSeriesColor(index: number): string {
  const n = CHART_SERIES.length
  const i = ((Math.trunc(index) % n) + n) % n
  return CHART_SERIES[i]
}

export type ChartConcept = "ingresos" | "costos" | "gastos" | "ganancia" | "neutral"

/** Conceptos de dinero con color fijo en toda la app. */
export const CHART_CONCEPT_COLORS: Record<ChartConcept, string> = {
  // Dinero que entra → verde
  ingresos: "hsl(var(--chart-ingresos))",
  // Costo de lo vendido (repuestos, mano de obra) → naranja
  costos: "hsl(var(--chart-costos))",
  // Gasto operativo → rojo
  gastos: "hsl(var(--chart-gastos))",
  // Resultado / margen → azul
  ganancia: "hsl(var(--chart-ganancia))",
  // Comparación de fondo: mes anterior, "resto" de una torta
  neutral: "hsl(var(--chart-neutral))",
}

/** Semáforo (bien / atención / mal) para métricas con umbral. */
export const CHART_STATUS_COLORS = {
  success: "hsl(var(--success-500))",
  warning: "hsl(var(--warning-500))",
  danger: "hsl(var(--destructive))",
} as const
