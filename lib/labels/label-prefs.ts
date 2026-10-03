import {
  DIE_CUT_SIZES,
  THERMAL_SIZES,
  type LabelSizeKey,
  type PrintMedium,
} from "@/lib/labels/build-labels-html"

export const LABEL_PREFS_KEY = "stapp:etiqueta-inventario"
export const DEFAULT_MEDIUM: PrintMedium = "thermal"
export const DEFAULT_SIZE: LabelSizeKey = "50x30"

export interface LabelPrefs {
  medium: PrintMedium
  thermalSize: LabelSizeKey
  sheetSize: LabelSizeKey
}

/** Medio y tamaños recordados por dispositivo/navegador. Nunca tira. */
export function readLabelPrefs(): LabelPrefs | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(LABEL_PREFS_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<LabelPrefs>
    const medium: PrintMedium = v.medium === "sheet" ? "sheet" : DEFAULT_MEDIUM
    const thermalSize = THERMAL_SIZES.includes(v.thermalSize as LabelSizeKey)
      ? (v.thermalSize as LabelSizeKey)
      : DEFAULT_SIZE
    // La hoja solo admite die-cut: un rollo no es un tamaño válido ahí.
    const sheetSize = DIE_CUT_SIZES.includes(v.sheetSize as LabelSizeKey)
      ? (v.sheetSize as LabelSizeKey)
      : DEFAULT_SIZE
    return { medium, thermalSize, sheetSize }
  } catch {
    return null
  }
}

export function saveLabelPrefs(prefs: LabelPrefs): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(LABEL_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* localStorage no disponible (modo privado, etc.) */
  }
}
