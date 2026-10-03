export type OutputFormat = "PDF" | "ZPL" | "EPL"
export type BarcodeFormat = "AUTO" | "CODE128" | "EAN13" | "EAN8" | "UPC"

export function detectFormat(code: string): "CODE128" | "EAN13" | "EAN8" | "UPC" {
  if (/^\d{13}$/.test(code)) return "EAN13"
  if (/^\d{12}$/.test(code)) return "UPC"
  if (/^\d{8}$/.test(code)) return "EAN8"
  return "CODE128"
}

export function checkCompatibility(
  code: string,
  format: BarcodeFormat,
): { ok: boolean; reason?: string } {
  const trimmed = code.trim()
  if (!trimmed) return { ok: false, reason: "Sin código" }
  if (format === "AUTO" || format === "CODE128") return { ok: true }
  const onlyDigits = trimmed.replace(/\D/g, "")
  const lengthRules: Record<string, number> = { EAN13: 13, EAN8: 8, UPC: 12 }
  const expected = lengthRules[format]
  if (onlyDigits.length !== expected) {
    return { ok: false, reason: `Necesita ${expected} dígitos (tiene ${onlyDigits.length || trimmed.length})` }
  }
  if (onlyDigits !== trimmed) {
    return { ok: false, reason: "Contiene caracteres no numéricos" }
  }
  return { ok: true }
}

export interface LabelContentItem {
  nombre: string
  codigo: string
  barcode?: string | null
  precioVenta: number
}

export interface LabelContentOptions {
  outputFormat: OutputFormat
  barcodeFormat: BarcodeFormat
  showBarcode: boolean
  showName: boolean
  showCode: boolean
  showPrice: boolean
}

export interface LabelContent {
  /** false = la fila queda deshabilitada / no se imprime. */
  printable: boolean
  /** Motivo del bloqueo cuando printable es false por falta de código (Zebra). */
  blockedReason?: string
  /** Código efectivo (barcode o codigo, recortado). Vacío si no tiene. */
  code: string
  /** Lleva bloque de código de barras. */
  barcode: boolean
  showName: boolean
  /** Línea de texto con el código; solo si el item tiene código. */
  showCodeText: boolean
  showPrice: boolean
  /** Aviso informativo para la fila (se imprime igual, sin barras). */
  notice?: string
}

export const ZEBRA_NO_CODE_REASON = "Sin código: las plantillas Zebra requieren código de barras"
export const NO_CODE_NOTICE = "Sin código — se imprime solo nombre y precio"

/**
 * Decide qué lleva la etiqueta de un item. En PDF un item sin código (o con un
 * código que no sirve para el formato elegido) sale como etiqueta de precio.
 * Las plantillas ZPL/EPL siempre llevan barras, así que sin código se bloquean.
 */
export function resolveLabelContent(
  item: LabelContentItem,
  opts: LabelContentOptions,
): LabelContent {
  const code = (item.barcode || item.codigo || "").trim()
  const hasCode = code.length > 0

  if (opts.outputFormat !== "PDF") {
    return {
      printable: hasCode,
      blockedReason: hasCode ? undefined : ZEBRA_NO_CODE_REASON,
      code,
      barcode: hasCode,
      showName: true,
      showCodeText: hasCode,
      showPrice: true,
    }
  }

  let barcode = false
  let notice: string | undefined
  if (!hasCode) {
    notice = NO_CODE_NOTICE
  } else if (opts.showBarcode) {
    const compat = checkCompatibility(code, opts.barcodeFormat)
    if (compat.ok) barcode = true
    else notice = `Se imprime sin código de barras: ${compat.reason}`
  }

  const showCodeText = opts.showCode && hasCode
  const printable = barcode || opts.showName || opts.showPrice || showCodeText

  return {
    printable,
    code,
    barcode,
    showName: opts.showName,
    showCodeText,
    showPrice: opts.showPrice,
    notice,
  }
}
