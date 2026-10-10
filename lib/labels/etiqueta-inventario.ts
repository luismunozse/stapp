import {
  DIE_CUT_SIZES,
  THERMAL_SIZES,
  type LabelSizeKey,
  type PrintMedium,
} from "@/lib/labels/build-labels-html"

/**
 * Validaciones puras del medio + tamaño de las etiquetas de INVENTARIO por
 * taller. Las comparten la API y el cliente. Los CHECK de la migración
 * etiqueta_inventario_* deben listar exactamente estos valores (hay un test).
 */
export const PRINT_MEDIA: PrintMedium[] = ["thermal", "sheet"]

export function isPrintMedium(v: unknown): v is PrintMedium {
  return typeof v === "string" && (PRINT_MEDIA as string[]).includes(v)
}

export function isLabelSizeKey(v: unknown): v is LabelSizeKey {
  return typeof v === "string" && (THERMAL_SIZES as string[]).includes(v)
}

/** La hoja solo admite die-cut: un rollo (58mm/80mm) no es válido ahí. */
export function isValidMediumSize(medio: unknown, tamano: unknown): medio is PrintMedium {
  if (!isPrintMedium(medio) || !isLabelSizeKey(tamano)) return false
  return medio === "thermal" || DIE_CUT_SIZES.includes(tamano)
}
