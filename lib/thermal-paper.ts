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

/**
 * Tope del logo impreso por USB, en puntos del cabezal (≈8 puntos/mm). Es el
 * mismo tamaño que muestra la vista previa (200×100px a 96dpi ≈ 53×26mm), sin
 * pasar del ancho del cabezal. Sin tope de alto, un logo cuadrado en 80mm
 * ocupaba ~7cm de papel.
 */
export function logoMaxDots(a: AnchoTermico): { maxWidth: number; maxHeight: number } {
  return { maxWidth: Math.min(anchoLogoDots(a), 424), maxHeight: 212 }
}

const ALINEAR_ARRIBA_KEY = "stapp:comprobante-alinear-arriba"

/**
 * Preferencia por dispositivo para la impresión por navegador: no achicar la
 * página al alto del comprobante, así sale pegado al borde superior de la hoja
 * del driver. Sirve en impresoras con papel de largo fijo que cortan al final
 * de lo impreso (ver ajustarPaginaImpresion en lib/print-fit-page.ts).
 */
export function readAlinearArriba(): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(ALINEAR_ARRIBA_KEY) === "1"
  } catch {
    return false
  }
}

export function saveAlinearArriba(valor: boolean): void {
  if (typeof window === "undefined") return
  try {
    if (valor) window.localStorage.setItem(ALINEAR_ARRIBA_KEY, "1")
    else window.localStorage.removeItem(ALINEAR_ARRIBA_KEY)
  } catch {
    /* localStorage no disponible (modo privado, etc.) */
  }
}
