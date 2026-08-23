import { isRubroId, DEFAULT_RUBRO_ID } from "./index"
import { derivarDesdeDetalle } from "./detalle"

/**
 * Valida la elección de rubro del registro.
 *
 * Pura y client-safe: la usa el formulario. El backend igual es permisivo (un
 * rubro ausente cae al genérico) porque hay otras vías de alta — app-entry y
 * el flujo de Google — que no muestran el selector.
 *
 * Devuelve el mensaje de error, o null si está bien.
 */
export function validarSeleccionRubro(
  rubro: string | null | undefined,
  detalle: string | null | undefined
): string | null {
  const elegido = typeof rubro === "string" ? rubro.trim() : ""

  // Sin preselección en el formulario: elegir es obligatorio. Dejar el genérico
  // preseleccionado convertía la peor opción en el camino de menor resistencia.
  if (elegido === "" || !isRubroId(elegido)) {
    return "Elegí qué reparás"
  }

  if (elegido !== DEFAULT_RUBRO_ID) return null

  // Eligió "Otro servicio técnico": el texto libre es lo único de lo que sale
  // el tipo de equipo y el vocabulario. Sin eso vuelve a ser un callejón.
  const texto = typeof detalle === "string" ? detalle.trim() : ""
  if (texto === "") {
    return "Contanos qué reparás para preparar tu cuenta"
  }

  if (derivarDesdeDetalle(texto) === null) {
    return "Escribí qué reparás con palabras, por ejemplo: máquinas de café"
  }

  return null
}
