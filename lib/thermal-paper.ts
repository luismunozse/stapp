// Ancho de rollo térmico para el comprobante. Son los dos anchos estándar del
// mercado (58 y 80mm); el motor ESC/POS (generateOrdenTicketCommands) ya soporta
// ambos, y la impresión por navegador se ajusta vía @page / ancho del preview.

export type AnchoTermico = 58 | 80

export const ANCHOS_TERMICOS: AnchoTermico[] = [58, 80]
export const DEFAULT_ANCHO: AnchoTermico = 80

export type Codepage = "cp437" | "cp850" | "cp858" | "win1252"
export type Corte = "gsv" | "esci" | "none"

export interface PrinterProfile {
  ancho: AnchoTermico
  columnas: number
  codepage: Codepage
  corte: Corte
}

const PROFILE_KEY = "stapp:printer-profile"
// Claves previas al perfil; se migran en la primera lectura.
const LEGACY_ANCHO_KEY = "stapp:comprobante-ancho" // ordenes
const LEGACY_POS_KEY = "pos_printer_width" // POS

export function columnasDefault(a: AnchoTermico): number {
  return a === 58 ? 32 : 48
}

export function defaultProfile(ancho: AnchoTermico = DEFAULT_ANCHO): PrinterProfile {
  return { ancho, columnas: columnasDefault(ancho), codepage: "cp858", corte: "gsv" }
}

const CODEPAGES: Codepage[] = ["cp437", "cp850", "cp858", "win1252"]
const CORTES: Corte[] = ["gsv", "esci", "none"]

function isValidProfile(p: unknown): p is PrinterProfile {
  if (typeof p !== "object" || p === null) return false
  const q = p as Record<string, unknown>
  return (
    (q.ancho === 58 || q.ancho === 80) &&
    (q.columnas === 32 || q.columnas === 42 || q.columnas === 48) &&
    CODEPAGES.includes(q.codepage as Codepage) &&
    CORTES.includes(q.corte as Corte)
  )
}

export function readProfile(): PrinterProfile {
  if (typeof window === "undefined") return defaultProfile()
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY)
    if (raw) {
      const p: unknown = JSON.parse(raw)
      return isValidProfile(p) ? p : defaultProfile()
    }
    const legacy =
      window.localStorage.getItem(LEGACY_ANCHO_KEY) ??
      window.localStorage.getItem(LEGACY_POS_KEY)
    const n = parseInt(legacy ?? "", 10)
    return n === 58 || n === 80 ? defaultProfile(n) : defaultProfile()
  } catch {
    return defaultProfile()
  }
}

export function saveProfile(p: PrinterProfile): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
  } catch {
    /* localStorage no disponible (modo privado, etc.) */
  }
}

/** Ancho recordado por dispositivo (compat: delega en el perfil). */
export function readAncho(): AnchoTermico {
  return readProfile().ancho
}

/** Cambiar el ancho resetea columnas a su default; codepage y corte se conservan. */
export function saveAncho(a: AnchoTermico): void {
  const p = readProfile()
  saveProfile({ ...p, ancho: a, columnas: columnasDefault(a) })
}

/** Ancho físico en px para el preview en pantalla (≈96dpi). */
export function anchoToPx(a: AnchoTermico): number {
  return Math.round((a * 96) / 25.4) // 58 -> 219, 80 -> 302
}

/** Ancho de raster del logo en puntos según el cabezal (58mm≈384pt, 80mm≈576pt). */
export function anchoLogoDots(a: AnchoTermico): number {
  return a === 58 ? 384 : 576
}
