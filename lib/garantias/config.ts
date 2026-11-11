/**
 * Configuración de garantías de la organización (migración 402). Sin
 * dependencias de servidor: la usan la API, los PDF, el cron y la pantalla de
 * configuración.
 *
 *   - terminos: texto de la org que se imprime en el comprobante de entrega y
 *     en el certificado de venta. NO reemplaza las condiciones que se escriben
 *     en cada entrega (garantias.notas): se imprimen las dos, primero las de la
 *     entrega y después los términos de la org.
 *   - ventanaPorVencer: días de la pestaña "Por vencer", la tarjeta del
 *     dashboard y el aviso al cliente (decisión 5 del doc: 7, configurable).
 *   - avisoVencimiento: aviso al cliente antes del vencimiento (decisión 6:
 *     opcional, apagado por defecto).
 */
import { VENTANA_POR_VENCER_DIAS, VENTANA_POR_VENCER_MAX } from "./estado"

export const GARANTIA_TERMINOS_MAX = 2000
export const VENTANA_CONFIG_MIN = 1

export interface ConfigGarantiasOrg {
  terminos: string | null
  ventanaPorVencer: number
  avisoVencimiento: boolean
}

export const CONFIG_GARANTIAS_DEFAULT: ConfigGarantiasOrg = {
  terminos: null,
  ventanaPorVencer: VENTANA_POR_VENCER_DIAS,
  avisoVencimiento: false,
}

/** Ventana guardada → número usable. Una columna que falta (402 sin correr) o basura cae al default. */
export function ventanaDeOrg(valor: unknown): number {
  const n = typeof valor === "number" ? valor : Number.parseInt(String(valor ?? ""), 10)
  if (!Number.isInteger(n) || n < VENTANA_CONFIG_MIN || n > VENTANA_POR_VENCER_MAX) return VENTANA_POR_VENCER_DIAS
  return n
}

/** Términos limpios: sin espacios de más y NULL si quedan vacíos. */
export function normalizarTerminos(valor: unknown): string | null {
  if (typeof valor !== "string") return null
  const t = valor.replace(/\r\n?/g, "\n").trim()
  return t ? t : null
}

/** Fila de organizations (select("*")) → configuración. Tolera columnas que faltan. */
export function configGarantiasDeFila(fila: Record<string, unknown> | null | undefined): ConfigGarantiasOrg {
  if (!fila) return { ...CONFIG_GARANTIAS_DEFAULT }
  return {
    terminos: normalizarTerminos(fila.garantia_terminos),
    ventanaPorVencer: ventanaDeOrg(fila.garantia_ventana_por_vencer_dias),
    avisoVencimiento: fila.garantia_aviso_vencimiento === true,
  }
}

export type ResultadoValidacionConfig =
  | { ok: true; update: Record<string, string | number | boolean | null> }
  | { ok: false; error: string }

/**
 * Body del PUT de /api/configuracion/garantias → columnas a escribir. Solo
 * se escriben los campos que vienen; uno inválido rechaza todo el guardado
 * (con un mensaje para el ADMIN), así nunca queda guardada la mitad.
 */
export function validarConfigGarantias(body: unknown): ResultadoValidacionConfig {
  if (!body || typeof body !== "object") return { ok: false, error: "Datos inválidos" }
  const b = body as Record<string, unknown>
  const update: Record<string, string | number | boolean | null> = {}

  if (b.terminos !== undefined) {
    if (b.terminos !== null && typeof b.terminos !== "string") {
      return { ok: false, error: "Los términos de garantía tienen que ser texto" }
    }
    const t = normalizarTerminos(b.terminos)
    if (t && t.length > GARANTIA_TERMINOS_MAX) {
      return { ok: false, error: `Los términos de garantía no pueden pasar los ${GARANTIA_TERMINOS_MAX} caracteres` }
    }
    update.garantia_terminos = t
  }

  if (b.ventanaPorVencer !== undefined) {
    const n = typeof b.ventanaPorVencer === "number" ? b.ventanaPorVencer : Number(b.ventanaPorVencer)
    if (!Number.isInteger(n) || n < VENTANA_CONFIG_MIN || n > VENTANA_POR_VENCER_MAX) {
      return {
        ok: false,
        error: `La ventana "por vencer" tiene que ser un número entero de ${VENTANA_CONFIG_MIN} a ${VENTANA_POR_VENCER_MAX} días`,
      }
    }
    update.garantia_ventana_por_vencer_dias = n
  }

  if (b.avisoVencimiento !== undefined) {
    if (typeof b.avisoVencimiento !== "boolean") return { ok: false, error: "El aviso al cliente tiene que ser sí o no" }
    update.garantia_aviso_vencimiento = b.avisoVencimiento
  }

  if (Object.keys(update).length === 0) return { ok: false, error: "No hay cambios para guardar" }
  return { ok: true, update }
}

/**
 * Bloques de texto de la garantía para un PDF: las condiciones de esta
 * entrega (si hay) y los términos de la org (si hay), en ese orden. Si son el
 * mismo texto se imprime una sola vez.
 */
export function bloquesTerminosGarantia(
  condicionesEntrega: string | null | undefined,
  terminosOrg: string | null | undefined
): { titulo: string; texto: string }[] {
  const cond = normalizarTerminos(condicionesEntrega)
  const org = normalizarTerminos(terminosOrg)
  const bloques: { titulo: string; texto: string }[] = []
  if (cond) bloques.push({ titulo: "Condiciones de esta garantía", texto: cond })
  if (org && org !== cond) bloques.push({ titulo: "Términos de garantía", texto: org })
  return bloques
}
