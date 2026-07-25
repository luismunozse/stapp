// Ancho de rollo térmico para el comprobante. Son los dos anchos estándar del
// mercado (58 y 80mm); el motor ESC/POS (generateOrdenTicketCommands) ya soporta
// ambos, y la impresión por navegador se ajusta vía @page / ancho del preview.

export type AnchoTermico = 58 | 80

export const ANCHOS_TERMICOS: AnchoTermico[] = [58, 80]
export const DEFAULT_ANCHO: AnchoTermico = 80

const STORAGE_KEY = "stapp:comprobante-ancho"

/** Ancho recordado por dispositivo/navegador (fallback al default). */
export function readAncho(): AnchoTermico {
  if (typeof window === "undefined") return DEFAULT_ANCHO
  try {
    const n = parseInt(window.localStorage.getItem(STORAGE_KEY) ?? "", 10)
    return n === 58 || n === 80 ? (n as AnchoTermico) : DEFAULT_ANCHO
  } catch {
    return DEFAULT_ANCHO
  }
}

export function saveAncho(a: AnchoTermico): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, String(a))
  } catch {
    /* localStorage no disponible (modo privado, etc.) */
  }
}

/** Ancho físico en px para el preview en pantalla (≈96dpi). */
export function anchoToPx(a: AnchoTermico): number {
  return Math.round((a * 96) / 25.4) // 58 -> 219, 80 -> 302
}

/** Ancho de raster del logo en puntos según el cabezal (58mm≈384pt, 80mm≈576pt). */
export function anchoLogoDots(a: AnchoTermico): number {
  return a === 58 ? 384 : 576
}
