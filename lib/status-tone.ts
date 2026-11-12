/**
 * Tonos de estado compartidos por todas las píldoras de estado de la app
 * (órdenes, ventas, pagos, garantías, cotizaciones, compras, tickets…).
 *
 * Acá solo viven los nombres y los hex para contextos sin Tailwind (emails,
 * gráficos). Las clases de Tailwind están en `components/ui/status-pill.tsx`,
 * porque el `content` de Tailwind no escanea `lib/` y las clases que vivan acá
 * no se generarían.
 */

export const STATUS_TONES = [
  "neutral",
  "muted",
  "info",
  "success",
  "warning",
  "danger",
  "violet",
  "orange",
  "pink",
  "cyan",
  "teal",
  "emerald",
] as const

export type StatusTone = (typeof STATUS_TONES)[number]

/**
 * Par texto/fondo en hex para HTML de emails (fondo tono 50, texto tono 700:
 * todos los pares dan ≥4,5:1).
 */
export const STATUS_TONE_HEX: Record<StatusTone, { fg: string; bg: string }> = {
  neutral: { fg: "#334155", bg: "#f1f5f9" },
  muted: { fg: "#475569", bg: "#f8fafc" },
  info: { fg: "#0369a1", bg: "#f0f9ff" },
  success: { fg: "#15803d", bg: "#f0fdf4" },
  warning: { fg: "#b45309", bg: "#fffbeb" },
  danger: { fg: "#b91c1c", bg: "#fef2f2" },
  violet: { fg: "#6d28d9", bg: "#f5f3ff" },
  orange: { fg: "#c2410c", bg: "#fff7ed" },
  pink: { fg: "#be185d", bg: "#fdf2f8" },
  cyan: { fg: "#0e7490", bg: "#ecfeff" },
  teal: { fg: "#0f766e", bg: "#f0fdfa" },
  emerald: { fg: "#047857", bg: "#ecfdf5" },
}
