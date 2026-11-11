/**
 * Pestañas de /reportes que dependen de la feature `advanced_reports` (plan
 * Profesional). Es el espejo de las APIs que contestan 403 FEATURE_REQUIRED:
 * tiempo-reparacion, tasa-retorno, fallas-comunes, rentabilidad,
 * rentabilidad-tecnicos y prediccion-repuestos. Técnicos, Vendedores, Clientes
 * e Inventario no tienen ese guard y quedan abiertas en Free.
 */
export const REPORTES_PRO = {
  "tiempo-reparacion": {
    nombre: "Tiempos de reparación",
    descripcion:
      "Mirá cuánto tarda en promedio cada tipo de equipo y detectá dónde se te traba el taller.",
  },
  "tasa-retorno": {
    nombre: "Tasa de retorno",
    descripcion: "Sabé qué porcentaje de tus clientes vuelve y quiénes son los más fieles.",
  },
  fallas: {
    nombre: "Fallas más comunes",
    descripcion:
      "Descubrí qué problemas se repiten más para anticiparte con repuestos y diagnósticos.",
  },
  rentabilidad: {
    nombre: "Rentabilidad por equipo",
    descripcion: "Compará ingresos, costos y margen por tipo de dispositivo.",
  },
  "rentabilidad-tecnicos": {
    nombre: "Rentabilidad por técnico",
    descripcion: "Mirá cuánto deja cada técnico: horas, ingresos, costos y comisiones.",
  },
  prediccion: {
    nombre: "Predicción de repuestos",
    descripcion: "Anticipá qué repuestos se te van a agotar según el uso histórico.",
  },
} as const

export type ReportePro = keyof typeof REPORTES_PRO

export function esReportePro(tab: string): tab is ReportePro {
  return Object.prototype.hasOwnProperty.call(REPORTES_PRO, tab)
}

export const BENEFICIOS_REPORTES_PRO = [
  "Tiempo de reparación por tipo de equipo",
  "Tasa de retorno y fallas más comunes",
  "Rentabilidad por equipo y por técnico",
  "Predicción de repuestos según el uso",
]
