// Constructor puro del HTML de impresión de etiquetas de inventario.
// No toca el DOM: recibe las etiquetas ya resueltas (con el SVG del código de
// barras ya generado, o sin él) y devuelve el documento completo.

export type PrintMedium = "thermal" | "sheet"

export type LabelSizeKey = "40x25" | "38x25" | "50x30" | "60x40" | "58mm" | "80mm"

export interface LabelSizeConfig {
  /** "label" = etiqueta die-cut de medida fija; "roll" = rollo de ancho fijo y alto automático. */
  mode: "label" | "roll"
  widthMm: number
  /** undefined = alto automático (rollo). */
  heightMm?: number
  label: string
}

export const LABEL_SIZE_CONFIG: Record<LabelSizeKey, LabelSizeConfig> = {
  "40x25": { mode: "label", widthMm: 40, heightMm: 25, label: "40 × 25 mm" },
  "38x25": { mode: "label", widthMm: 38, heightMm: 25, label: "38 × 25 mm" },
  "50x30": { mode: "label", widthMm: 50, heightMm: 30, label: "50 × 30 mm" },
  "60x40": { mode: "label", widthMm: 60, heightMm: 40, label: "60 × 40 mm" },
  "58mm": { mode: "roll", widthMm: 58, label: "Rollo 58 mm" },
  "80mm": { mode: "roll", widthMm: 80, label: "Rollo 80 mm" },
}

export const DIE_CUT_SIZES: LabelSizeKey[] = ["40x25", "38x25", "50x30", "60x40"]
export const THERMAL_SIZES: LabelSizeKey[] = [...DIE_CUT_SIZES, "58mm", "80mm"]

/** Una etiqueta ya resuelta. Las partes ausentes no se renderizan. */
export interface BuiltLabel {
  name?: string
  /** SVG del código de barras. Sin él, la etiqueta es de precio (label--price). */
  barcodeSvg?: string
  code?: string
  /** Precio ya formateado. */
  price?: string
}

export interface BuildLabelsOptions {
  medium: PrintMedium
  size: LabelSizeKey
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function labelBlock(l: BuiltLabel): string {
  const withBarcode = !!l.barcodeSvg
  return `<div class="label${withBarcode ? "" : " label--price"}">
  ${l.name ? `<div class="name">${escapeHtml(l.name)}</div>` : ""}
  ${withBarcode ? `<div class="barcode">${l.barcodeSvg}</div>` : ""}
  ${l.code ? `<div class="code">${escapeHtml(l.code)}</div>` : ""}
  ${l.price ? `<div class="price">${escapeHtml(l.price)}</div>` : ""}
</div>`
}

export function buildLabelsHtml(labels: BuiltLabel[], opts: BuildLabelsOptions): string {
  const cfg = LABEL_SIZE_CONFIG[opts.size] ?? LABEL_SIZE_CONFIG["50x30"]
  const styles =
    opts.medium === "sheet"
      ? sheetStyles(cfg)
      : cfg.mode === "roll"
        ? rollStyles(cfg)
        : dieCutStyles(cfg)
  const printScript =
    opts.medium === "sheet"
      ? `\n  <script>window.onload=function(){setTimeout(function(){window.print();},100);}<\/script>`
      : ""

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Etiquetas</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
${styles}
</style></head><body>
  <div class="sheet">${labels.map(labelBlock).join("")}</div>${printScript}
</body></html>`
}

// ---- Hoja A4 / planchas (layout original, sin cambios) ----

function sheetStyles(cfg: LabelSizeConfig): string {
  const w = cfg.widthMm
  const h = cfg.heightMm ?? 30
  return `  @page { size: auto; margin: 5mm; }
  .sheet {
    display: flex; flex-wrap: wrap;
    gap: 2mm;
  }
  .label {
    width: ${w}mm;
    height: ${h}mm;
    padding: 1mm 1.5mm;
    border: 1px dashed #ccc;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    overflow: hidden;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  @media print { .label { border: none; } }
  .name {
    font-size: ${w >= 50 ? 9 : 7}pt;
    font-weight: 600;
    text-align: center;
    width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.1;
  }
  .barcode { width: 100%; flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .barcode svg { width: 100%; height: 100%; max-height: 100%; }
  .code {
    font-size: ${w >= 50 ? 7 : 6}pt;
    font-family: 'Courier New', monospace;
    letter-spacing: 0.5px;
    line-height: 1;
  }
  .label--price .name {
    white-space: normal;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    font-size: ${w >= 50 ? 10 : 8}pt;
  }
  .label--price .price {
    font-size: ${w >= 50 ? 20 : 15}pt;
    margin-top: 2px;
  }
  .price {
    font-size: ${w >= 50 ? 11 : 9}pt;
    font-weight: 700;
    line-height: 1.1;
    margin-top: 1px;
  }`
}

// ---- Térmica die-cut: una etiqueta por página, tamaño exacto ----

function dieCutStyles(cfg: LabelSizeConfig): string {
  const w = cfg.widthMm
  const h = cfg.heightMm ?? 30
  // Escala relativa a la baseline 60×40, con piso para que el texto no se vuelva ilegible.
  const scale = Math.max(0.72, Math.min(w / 60, h / 40))
  const pad = scale < 0.85 ? 1 : 1.5
  const pt = (base: number) => (base * scale).toFixed(1)
  return `  @page { size: ${w}mm ${h}mm; margin: 0; }
  .sheet { display: block; }
  .label {
    width: ${w}mm;
    height: ${h}mm;
    padding: ${pad}mm;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    overflow: hidden;
    break-after: page;
    page-break-after: always;
    break-inside: avoid;
  }
  .label:last-child { break-after: auto; page-break-after: auto; }
  .name { font-size: ${pt(9)}pt; font-weight: 600; text-align: center; width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.1; }
  .barcode { width: 100%; flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .barcode svg { width: 100%; height: 100%; max-height: 100%; }
  .code { font-size: ${pt(7)}pt; font-family: 'Courier New', monospace; letter-spacing: 0.5px; line-height: 1; }
  .price { font-size: ${pt(11)}pt; font-weight: 700; line-height: 1.1; margin-top: 0.3mm; }
  .label--price .name { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; font-size: ${pt(10)}pt; }
  .label--price .price { font-size: ${pt(20)}pt; margin-top: 0.8mm; }`
}

// ---- Térmica rollo: ancho fijo, alto automático, una etiqueta por página ----

function rollStyles(cfg: LabelSizeConfig): string {
  const w = cfg.widthMm
  const big = w >= 80
  return `  @page { size: ${w}mm auto; margin: 0; }
  .sheet { display: block; }
  .label {
    width: ${w}mm;
    padding: 2mm;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    text-align: center;
    break-after: page;
    page-break-after: always;
    break-inside: avoid;
  }
  .label:last-child { break-after: auto; page-break-after: auto; }
  .name { font-size: ${big ? 11 : 9}pt; font-weight: 600; width: 100%; line-height: 1.15; word-break: break-word; }
  .barcode { width: 100%; height: ${big ? 18 : 14}mm; margin: 1mm 0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .barcode svg { width: 100%; height: 100%; }
  .code { font-size: ${big ? 8 : 7}pt; font-family: 'Courier New', monospace; letter-spacing: 0.5px; line-height: 1.1; }
  .price { font-size: ${big ? 16 : 13}pt; font-weight: 700; line-height: 1.1; margin-top: 1mm; }
  .label--price .price { font-size: ${big ? 26 : 22}pt; }`
}
