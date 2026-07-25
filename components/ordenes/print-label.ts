import QRCode from "qrcode"

export interface LabelData {
  codigoOrden: string
  numeroOrden: number
  clienteNombre: string
  dispositivo: string
  problemaReportado: string
  fechaIngreso: string
  publicToken?: string | null
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

export type LabelSize = "40x30" | "50x30" | "50x40" | "60x40" | "58mm" | "80mm"

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

export const LABEL_SIZES: LabelSize[] = ["40x30", "50x30", "50x40", "60x40", "58mm", "80mm"]
export const DEFAULT_LABEL_SIZE: LabelSize = "60x40"
export const LABEL_SIZE_OPTIONS: { value: LabelSize; label: string }[] = LABEL_SIZES.map((v) => ({
  value: v,
  label: SIZE_CONFIG[v].label,
}))

const STORAGE_KEY = "stapp:etiqueta-size"

/** Tamaño de etiqueta recordado por dispositivo/navegador (fallback al default). */
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
 * Devuelve el HTML completo de la etiqueta para el tamaño dado. QR se pasa ya
 * generado (data URL) o "" si no hay. Función pura: no toca el DOM.
 */
export function buildLabelHtml(data: LabelData, size: LabelSize, qrDataUrl: string): string {
  const cfg = SIZE_CONFIG[size] ?? SIZE_CONFIG[DEFAULT_LABEL_SIZE]
  const esReparado = data.variant === "reparado"
  const codigo = esc(data.codigoOrden || `#${data.numeroOrden}`)
  const empresa = data.organizationName ? esc(data.organizationName) : ""
  const fechaPie = esc(esReparado ? data.fechaReparacion || data.fechaIngreso : data.fechaIngreso)
  const title = `Etiqueta ${esReparado ? "Reparado " : ""}${codigo}`

  const body =
    cfg.mode === "roll"
      ? rollBody({ esReparado, codigo, empresa, fechaPie, data, qrDataUrl })
      : dieCutBody({ esReparado, codigo, empresa, fechaPie, data, qrDataUrl })

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

// ---- Die-cut (etiqueta adhesiva de medida fija) ----

function dieCutStyles(cfg: SizeConfig): string {
  const w = cfg.widthMm
  const h = cfg.heightMm ?? 40
  // Escala relativa a la baseline 60×40, con piso para que el texto no se vuelva ilegible.
  const scale = Math.max(0.72, Math.min(w / 60, h / 40))
  const bodyPt = (7 * scale).toFixed(1)
  const pad = scale < 0.85 ? 1.5 : 2.5
  const qrMm = Math.round(Math.min(h * 0.42, w * 0.28))
  return `  @page { size: ${w}mm ${h}mm; margin: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    width: ${w}mm; height: ${h}mm; padding: ${pad}mm;
    color: #000; display: flex; overflow: hidden;
    font-size: ${bodyPt}pt;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .left { flex: 1; display: flex; flex-direction: column; justify-content: space-between; min-width: 0; padding-right: 1.5mm; }
  .right { width: ${qrMm + 1}mm; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .right img { width: ${qrMm}mm; height: ${qrMm}mm; }
  .right .scan { font-size: 0.7em; color: #666; margin-top: 0.5mm; text-align: center; }
  .codigo { font-size: 1.9em; font-weight: bold; letter-spacing: 0.3px; line-height: 1.05; border-bottom: 1px solid #000; padding-bottom: 0.6mm; margin-bottom: 0.6mm; }
  .empresa { font-size: 0.85em; color: #555; margin-bottom: 0.3mm; }
  .info { line-height: 1.25; flex: 1; }
  .info .label { color: #666; font-size: 0.85em; }
  .info .value { font-weight: bold; }
  .info > div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .badge { display: inline-block; background: #000; color: #fff; font-size: 1.15em; font-weight: bold; letter-spacing: 0.3px; padding: 0.5mm 1.5mm; margin-bottom: 0.6mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .listo { font-size: 1em; font-weight: bold; margin-top: 0.3mm; }
  .fecha { font-size: 0.8em; color: #888; margin-top: auto; }`
}

function dieCutBody(p: {
  esReparado: boolean
  codigo: string
  empresa: string
  fechaPie: string
  data: LabelData
  qrDataUrl: string
}): string {
  const cliente = esc(truncate(p.data.clienteNombre, 25))
  const dispositivo = esc(truncate(p.data.dispositivo, 28))
  const problema = esc(truncate(p.data.problemaReportado, 50))
  return `  <div class="left">
    ${p.empresa ? `<div class="empresa">${p.empresa}</div>` : ""}
    <div class="codigo">${p.codigo}</div>
    ${p.esReparado ? `<span class="badge">✓ REPARADO</span>` : ""}
    <div class="info">
      <div><span class="label">Cliente: </span><span class="value">${cliente}</span></div>
      <div><span class="label">Equipo: </span><span class="value">${dispositivo}</span></div>
      ${p.esReparado
        ? `<div class="listo">Listo para entregar</div>`
        : `<div><span class="label">Problema: </span>${problema}</div>`}
    </div>
    <div class="fecha">${p.fechaPie}</div>
  </div>
  ${p.qrDataUrl
      ? `<div class="right"><img src="${p.qrDataUrl}" alt="QR" /><div class="scan">Seguimiento</div></div>`
      : ""}`
}

// ---- Rollo (ticket continuo 58/80mm, vertical) ----

function rollStyles(cfg: SizeConfig): string {
  const w = cfg.widthMm
  const qrMm = w >= 80 ? 34 : 28
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
  .fecha { font-size: 0.85em; color: #666; margin-top: 1mm; }
  .qr { margin-top: 1.5mm; }
  .qr img { width: ${qrMm}mm; height: ${qrMm}mm; }
  .qr .scan { font-size: 0.75em; color: #666; }`
}

function rollBody(p: {
  esReparado: boolean
  codigo: string
  empresa: string
  fechaPie: string
  data: LabelData
  qrDataUrl: string
}): string {
  const cliente = esc(truncate(p.data.clienteNombre, 32))
  const dispositivo = esc(truncate(p.data.dispositivo, 36))
  const problema = esc(truncate(p.data.problemaReportado, 90))
  return `  ${p.empresa ? `<div class="empresa">${p.empresa}</div>` : ""}
  <div class="codigo">${p.codigo}</div>
  ${p.esReparado ? `<span class="badge">✓ REPARADO</span>` : ""}
  <div class="row"><span class="label">Cliente: </span>${cliente}</div>
  <div class="row"><span class="label">Equipo: </span>${dispositivo}</div>
  ${p.esReparado
      ? `<div class="listo">Listo para entregar</div>`
      : `<div class="row"><span class="label">Problema: </span>${problema}</div>`}
  <div class="fecha">${p.fechaPie}</div>
  ${p.qrDataUrl
      ? `<div class="qr"><img src="${p.qrDataUrl}" alt="QR" /><div class="scan">Seguimiento</div></div>`
      : ""}`
}

// ============================================
// IMPRESIÓN VÍA DRIVER (iframe oculto)
// ============================================
// Mismo mecanismo robusto que el comprobante térmico: render a un iframe oculto,
// esperar imágenes (QR), y disparar el print del driver. Más confiable que
// window.open y compatible con cualquier impresora que tenga driver en el SO.

/**
 * Tope de espera para que una imagen (el QR) termine de cargar antes de
 * imprimir igual, y tope de espera para que el iframe dispare `onload` antes
 * de imprimir igual. El QR es un data URI: en la practica ambas esperas
 * resuelven casi instantaneo. Si alguna no lo hace, imprimir con el QR sin
 * pintar (o disparar el print apenas se puede) es un resultado muchisimo
 * mejor que congelar el mostrador: el operador puede reimprimir una
 * etiqueta: no puede recuperarse de un modal trabado en medio de un lote.
 * No "arreglar" esto de vuelta a una espera sin limite.
 */
const IMAGE_LOAD_TIMEOUT_MS = 3000
const IFRAME_LOAD_TIMEOUT_MS = 3000

/**
 * Espera `promise`, pero nunca mas de `timeoutMs`. Si el timeout gana, avisa
 * por consola (para que esto sea diagnosticable, no invisible) y resuelve
 * igual -- nunca rechaza por timeout, ese es el punto: preferir seguir
 * adelante antes que trabarse.
 */
function waitOrTimeout(promise: Promise<unknown>, timeoutMs: number, warning: string): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      console.warn(warning)
      resolve()
    }, timeoutMs)

    promise.then(
      () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve()
      },
      () => {
        // Las promesas por imagen ya resuelven tanto en onload como en
        // onerror (nunca rechazan), pero por las dudas: un reject
        // inesperado tampoco debe colgar esto.
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve()
      },
    )
  })
}

/**
 * Resuelve recien cuando el print() del driver termino (triggerPrint()
 * awaiteado en las dos ramas), no cuando el iframe se creo. Los llamadores
 * (printDeviceLabel, y por extension un loop secuencial como el de
 * recepcion-creada-modal.tsx) dependen de que este promise abarque el
 * dialogo real: si resolviera antes, un `await` encadenado dispararia el
 * siguiente print sin esperar a que el anterior termine, que es exactamente
 * lo que la impresion secuencial de etiquetas necesita evitar.
 *
 * Tambien debe *rechazar* cuando triggerPrint() rechaza (por ejemplo si
 * `print()` tira), en las dos ramas por igual -- si no, un error se pierde
 * en vez de propagarse a quien llama, y peor: si la rama quedara sin
 * resolver ni rechazar, printDeviceLabel (y todo lo que lo espera) se
 * cuelga para siempre.
 */
async function printHtmlViaIframe(html: string): Promise<void> {
  if (typeof document === "undefined") return
  const iframe = document.createElement("iframe")
  iframe.style.position = "fixed"
  iframe.style.right = "0"
  iframe.style.bottom = "0"
  iframe.style.width = "0"
  iframe.style.height = "0"
  iframe.style.border = "0"
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument || iframe.contentWindow?.document
  if (!doc) {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
    return
  }

  doc.open()
  doc.write(html)
  doc.close()

  const cleanup = () => {
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
    }, 1000)
  }

  const triggerPrint = async () => {
    try {
      const imgs = Array.from(doc.images)
      await waitOrTimeout(
        Promise.all(
          imgs.map((img) =>
            img.complete && img.naturalWidth > 0
              ? Promise.resolve()
              : new Promise<void>((res) => {
                  img.onload = () => res()
                  img.onerror = () => res()
                })
          )
        ),
        IMAGE_LOAD_TIMEOUT_MS,
        "printDeviceLabel: tiempo de espera agotado cargando una imagen (QR); se imprime igual.",
      )
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
    } finally {
      cleanup()
    }
  }

  if (doc.readyState === "complete") {
    await triggerPrint()
    return
  }

  // Disparar triggerPrint() una sola vez, sea porque onload llego a tiempo o
  // porque se agoto el timeout y se decide seguir igual. `printed` evita que
  // un onload tardio (despues de que el timeout ya disparo triggerPrint())
  // dispare una segunda impresion.
  await new Promise<void>((resolve, reject) => {
    let printed = false
    const runOnce = () => {
      if (printed) return Promise.resolve()
      printed = true
      return triggerPrint()
    }

    const timer = setTimeout(() => {
      console.warn("printDeviceLabel: tiempo de espera agotado esperando iframe.onload; se imprime igual.")
      runOnce().then(resolve, reject)
    }, IFRAME_LOAD_TIMEOUT_MS)

    iframe.onload = () => {
      clearTimeout(timer)
      runOnce().then(resolve, reject)
    }
  })
}

/**
 * Genera e imprime la etiqueta del equipo por el driver del SO.
 * @param opts.size tamaño/medio; si se omite, usa el recordado en localStorage.
 */
export async function printDeviceLabel(
  data: LabelData,
  baseUrl: string,
  opts?: { size?: LabelSize }
): Promise<void> {
  const size = opts?.size ?? readEtiquetaSize()

  let qrDataUrl = ""
  if (data.publicToken && baseUrl) {
    try {
      qrDataUrl = await QRCode.toDataURL(`${baseUrl}/seguimiento/${data.publicToken}`, {
        width: 240,
        margin: 0,
        errorCorrectionLevel: "M",
      })
    } catch {
      // QR generation failed, continue without it
    }
  }

  const html = buildLabelHtml(data, size, qrDataUrl)
  await printHtmlViaIframe(html)
}
