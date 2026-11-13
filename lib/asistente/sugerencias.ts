import type { Herramienta } from "./herramientas"

/**
 * Preguntas de ejemplo del panel vacío. Muestran lo que el usuario puede preguntar CON SUS
 * permisos: si una herramienta no está disponible (o un técnico no ve deudas), su sugerencia
 * no aparece. Siempre cierran con una del manual.
 */
export function sugerenciasPara(herramientas: readonly Pick<Herramienta, "definicion">[], verDeuda: boolean): string[] {
  const hay = new Set(herramientas.map((h) => h.definicion.name))
  const sugerencias: string[] = []
  if (hay.has("buscar_ordenes")) sugerencias.push("¿Qué órdenes están atrasadas?")
  if (hay.has("resumen_ordenes")) sugerencias.push("¿Cómo vienen las órdenes hoy?")
  if (hay.has("resumen_cliente")) {
    sugerencias.push(verDeuda ? "¿Cuánto me debe un cliente?" : "¿Qué órdenes tiene un cliente?")
  }
  sugerencias.push("¿Cómo creo una orden de servicio?")
  if (sugerencias.length < 4) sugerencias.push("¿Cómo cargo stock en el inventario?")
  if (sugerencias.length < 4) sugerencias.push("¿Cómo conecto WhatsApp?")
  return sugerencias.slice(0, 4)
}

/** Las del manual, para cuando no se pudo saber qué herramientas tiene el usuario. */
export const SUGERENCIAS_MANUAL = [
  "¿Cómo creo una orden de servicio?",
  "¿Cómo abro y cierro la caja?",
  "¿Cómo cargo stock en el inventario?",
  "¿Cómo conecto WhatsApp?",
]
