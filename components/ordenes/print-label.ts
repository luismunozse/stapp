import { printHtmlViaIframe } from "@/lib/print/print-html-iframe"
import { DEFAULT_LABEL_SIZE, LABEL_SIZES, type LabelSize } from "@/lib/etiqueta-tamano"
import { resolveEtiquetaSize } from "./etiqueta-size-org"

export { DEFAULT_LABEL_SIZE, LABEL_SIZES, type LabelSize }

export interface LabelData {
  codigoOrden: string
  numeroOrden: number
  clienteNombre: string
  /** Teléfono de contacto (contacto de la orden o, si no hay, el del cliente). */
  telefono?: string | null
  /** IMEI o número de serie (comparten la columna imei de la orden). */
  imei?: string | null
  problemaReportado: string
  fechaIngreso: string
  organizationName?: string
  /** "ingreso" (default): intake label with reported problem. "reparado": ready-for-pickup tag. */
  variant?: "ingreso" | "reparado"
  /** Repair completion date shown on the "reparado" variant (falls back to fechaIngreso). */
  fechaReparacion?: string
}

// ============================================
// TAMAÑOS SOPORTADOS
// ============================================
// "label" = etiqueta die-cut (medida física exacta ancho×alto).
// "roll"  = rollo continuo de tickets (ancho fijo, alto automático).
// Se imprime SIEMPRE por el driver del SO (path universal), así funciona en
// cualquier térmica con driver instalado — Zebra/TSC/Xprinter/Epson/etc. — sin
// depender de un lenguaje crudo (ESC/POS, ZPL, TSPL...) que sería exclusivo de
// una familia de impresoras.

interface SizeConfig {
  mode: "label" | "roll"
  widthMm: number
  /** undefined = alto automático (rollo). */
  heightMm?: number
  label: string
}

const SIZE_CONFIG: Record<LabelSize, SizeConfig> = {
  "40x30": { mode: "label", widthMm: 40, heightMm: 30, label: "Etiqueta 40×30 mm" },
  "50x30": { mode: "label", widthMm: 50, heightMm: 30, label: "Etiqueta 50×30 mm" },
  "50x40": { mode: "label", widthMm: 50, heightMm: 40, label: "Etiqueta 50×40 mm" },
  "60x40": { mode: "label", widthMm: 60, heightMm: 40, label: "Etiqueta 60×40 mm" },
  "58mm": { mode: "roll", widthMm: 58, label: "Rollo 58 mm" },
  "80mm": { mode: "roll", widthMm: 80, label: "Rollo 80 mm" },
}

export const LABEL_SIZE_OPTIONS: { value: LabelSize; label: string }[] = LABEL_SIZES.map((v) => ({
  value: v,
  label: SIZE_CONFIG[v].label,
}))

const STORAGE_KEY = "stapp:etiqueta-size"

/**
 * Tamaño recordado en ESTE navegador (legado, fallback al default). El tamaño
 * vigente del taller se resuelve con resolveEtiquetaSize (etiqueta-size-org).
 */
export function readEtiquetaSize(): LabelSize {
  if (typeof window === "undefined") return DEFAULT_LABEL_SIZE
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    return v && LABEL_SIZES.includes(v as LabelSize) ? (v as LabelSize) : DEFAULT_LABEL_SIZE
  } catch {
    return DEFAULT_LABEL_SIZE
  }
}

export function saveEtiquetaSize(size: LabelSize): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, size)
  } catch {
    /* localStorage no disponible (modo privado, etc.) */
  }
}

// ============================================
// CONSTRUCCIÓN DEL HTML (pura, testeable)
// ============================================

function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function truncate(v: string, max: number): string {
  return v.length > max ? v.substring(0, max) + "..." : v
}

/**
 * Devuelve el HTML completo de la etiqueta para el tamaño dado. Sin QR: la
 * etiqueta va pegada en el equipo y el link de seguimiento ya le llega al
 * cliente por el comprobante y WhatsApp. Función pura: no toca el DOM.
 */
export function buildLabelHtml(data: LabelData, size: LabelSize): string {
  const cfg = SIZE_CONFIG[size] ?? SIZE_CONFIG[DEFAULT_LABEL_SIZE]
  const esReparado = data.variant === "reparado"
  const codigo = esc(data.codigoOrden || `#${data.numeroOrden}`)
  const empresa = data.organizationName ? esc(data.organizationName) : ""
  const fechaPie = esc(esReparado ? data.fechaReparacion || data.fechaIngreso : data.fechaIngreso)
  const title = `Etiqueta ${esReparado ? "Reparado " : ""}${codigo}`

  const body =
    cfg.mode === "roll"
      ? rollBody({ esReparado, codigo, empresa, fechaPie, data })
      : dieCutBody({ esReparado, codigo, empresa, fechaPie, data })

  const styles = cfg.mode === "roll" ? rollStyles(cfg) : dieCutStyles(cfg)

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
${styles}
</style></head><body>
${body}
</body></html>`
}

// Líneas del bloque de datos compartidas por die-cut y rollo. Teléfono e IMEI
// se omiten si vienen vacíos. `cls` es la clase del contenedor de cada línea.
function dataLines(
  data: LabelData,
  max: { cliente: number; tel: number; imei: number },
  cls: string,
): string {
  const tel = data.telefono?.trim()
  const imei = data.imei?.trim()
  const line = (label: string, value: string) =>
    `<div${cls}><span class="label">${label}: </span><span class="value">${esc(value)}</span></div>`
  return [
    line("Cliente", truncate(data.clienteNombre, max.cliente)),
    tel ? line("Tel", truncate(tel, max.tel)) : "",
    imei ? line("IMEI/S/N", truncate(imei, max.imei)) : "",
  ]
    .filter(Boolean)
    .join("\n      ")
}

/** El problema es texto libre de largo arbitrario: se acota antes de armar el HTML. */
const PROBLEMA_MAX = 200

// ---- Die-cut (etiqueta adhesiva de medida fija) ----

function dieCutStyles(cfg: SizeConfig): string {
  const w = cfg.widthMm
  const h = cfg.heightMm ?? 40
  // Escala relativa a la baseline 60×40, con piso para que el texto no se vuelva ilegible.
  const scale = Math.max(0.72, Math.min(w / 60, h / 40))
  const bodyPt = (7 * scale).toFixed(1)
  const pad = scale < 0.85 ? 1.5 : 2.5
  // Etiquetas bajas (30mm) dejan 3 líneas al problema; las de 40mm, 5.
  const problemaLines = h >= 40 ? 5 : 3
  // El body llena el área imprimible (100%), no la página en mm: si el diálogo
  // de impresión o el driver suman margen, un alto fijo igual a la página
  // desborda a una segunda hoja y la térmica gasta dos etiquetas. Así, lo que
  // no entra se recorta y siempre sale una sola hoja.
  return `  @page { size: ${w}mm ${h}mm; margin: 0; }
  html { height: 100%; overflow: hidden; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    width: 100%; height: 100%; padding: ${pad}mm;
    color: #000; display: flex; overflow: hidden;
    font-size: ${bodyPt}pt;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .left { flex: 1; display: flex; flex-direction: column; justify-content: space-between; min-width: 0; }
  .codigo { font-size: 1.9em; font-weight: bold; letter-spacing: 0.3px; line-height: 1.05; border-bottom: 1px solid #000; padding-bottom: 0.6mm; margin-bottom: 0.6mm; }
  .empresa { font-size: 0.85em; color: #555; margin-bottom: 0.3mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .info { line-height: 1.25; flex: 1; min-height: 0; overflow: hidden; }
  .info .label { color: #666; font-size: 0.85em; }
  .info .value { font-weight: bold; }
  .info > div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* El problema es la única línea que envuelve; si falta alto, es lo que se recorta. */
  .info > .problema { white-space: normal; overflow: hidden; text-overflow: clip; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: ${problemaLines}; line-clamp: ${problemaLines}; }
  .badge { display: inline-block; background: #000; color: #fff; font-size: 1.15em; font-weight: bold; letter-spacing: 0.3px; padding: 0.5mm 1.5mm; margin-bottom: 0.6mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .listo { font-size: 1em; font-weight: bold; margin-top: 0.3mm; }
  .fecha { font-size: 0.8em; color: #888; margin-top: auto; flex-shrink: 0; }`
}

function dieCutBody(p: {
  esReparado: boolean
  codigo: string
  empresa: string
  fechaPie: string
  data: LabelData
}): string {
  const problema = esc(truncate(p.data.problemaReportado, PROBLEMA_MAX))
  return `  <div class="left">
    ${p.empresa ? `<div class="empresa">${p.empresa}</div>` : ""}
    <div class="codigo">${p.codigo}</div>
    ${p.esReparado ? `<span class="badge">✓ REPARADO</span>` : ""}
    <div class="info">
      ${dataLines(p.data, { cliente: 40, tel: 24, imei: 30 }, "")}
      ${p.esReparado
        ? `<div class="listo">Listo para entregar</div>`
        : `<div class="problema"><span class="label">Problema: </span>${problema}</div>`}
    </div>
    <div class="fecha">${p.fechaPie}</div>
  </div>`
}

// ---- Rollo (ticket continuo 58/80mm, vertical) ----

function rollStyles(cfg: SizeConfig): string {
  const w = cfg.widthMm
  return `  @page { size: ${w}mm auto; margin: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    width: ${w}mm; padding: 2mm; color: #000; text-align: center;
    font-size: 9pt;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .empresa { font-size: 0.85em; color: #555; }
  .codigo { font-size: 2em; font-weight: bold; line-height: 1.1; margin: 1mm 0; }
  .badge { display: inline-block; background: #000; color: #fff; font-size: 1.3em; font-weight: bold; padding: 1mm 3mm; margin: 1mm 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .row { text-align: left; margin: 0.4mm 0; word-break: break-word; }
  .row .label { color: #555; }
  .listo { font-weight: bold; margin: 1mm 0; }
  .fecha { font-size: 0.85em; color: #666; margin-top: 1mm; }`
}

function rollBody(p: {
  esReparado: boolean
  codigo: string
  empresa: string
  fechaPie: string
  data: LabelData
}): string {
  const problema = esc(truncate(p.data.problemaReportado, PROBLEMA_MAX))
  return `  ${p.empresa ? `<div class="empresa">${p.empresa}</div>` : ""}
  <div class="codigo">${p.codigo}</div>
  ${p.esReparado ? `<span class="badge">✓ REPARADO</span>` : ""}
  ${dataLines(p.data, { cliente: 32, tel: 24, imei: 30 }, ' class="row"')}
  ${p.esReparado
      ? `<div class="listo">Listo para entregar</div>`
      : `<div class="row"><span class="label">Problema: </span>${problema}</div>`}
  <div class="fecha">${p.fechaPie}</div>`
}

/**
 * Genera e imprime la etiqueta del equipo por el driver del SO.
 * @param opts.size tamaño/medio; si se omite, usa el de la org (luego localStorage, luego default).
 */
export async function printDeviceLabel(data: LabelData, opts?: { size?: LabelSize }): Promise<void> {
  const size = opts?.size ?? (await resolveEtiquetaSize())
  const html = buildLabelHtml(data, size)
  await printHtmlViaIframe(html)
}
