import { isRubroId, DEFAULT_RUBRO_ID } from "./index"
import { derivarDesdeDetalle } from "./detalle"

/**
 * Valida la elección de rubro del registro.
 *
 * Pura y client-safe: la usa el formulario. El backend igual es permisivo (un
 * rubro ausente cae al genérico): es la red de seguridad si algún cliente no lo
 * manda. Hoy todas las altas pasan por /registro (la app nativa también, desde
 * /app-entry), y el flujo de Google recibe el rubro desde ese formulario.
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

/** The rubro an org has stored, or the one a request asks for. */
export interface SeleccionRubro {
  rubro: string | null
  rubroDetalle: string | null
}

/**
 * True when the request would rebuild what the org already has. A curated pack
 * ignores the trade text (personalizarPack only reads it for genérico).
 *
 * Pure and client-safe: the onboarding wizard uses it too.
 */
export function mismoRubro(actual: SeleccionRubro, pedido: SeleccionRubro): boolean {
  if (actual.rubro !== pedido.rubro) return false
  if (pedido.rubro !== DEFAULT_RUBRO_ID) return true
  return (actual.rubroDetalle ?? "").trim() === (pedido.rubroDetalle ?? "").trim()
}
