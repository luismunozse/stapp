/**
 * Tamaños de etiqueta térmica soportados. Módulo puro (sin DOM ni qrcode) para
 * que lo compartan el cliente (print-label) y la API (whitelist). El CHECK de
 * organizations.etiqueta_tamano en la migración debe listar exactamente estos
 * valores: hay un test que lo verifica.
 */
export type LabelSize = "40x30" | "50x30" | "50x40" | "60x40" | "58mm" | "80mm"

export const LABEL_SIZES: LabelSize[] = ["40x30", "50x30", "50x40", "60x40", "58mm", "80mm"]
export const DEFAULT_LABEL_SIZE: LabelSize = "60x40"

export function isLabelSize(v: unknown): v is LabelSize {
  return typeof v === "string" && (LABEL_SIZES as string[]).includes(v)
}
