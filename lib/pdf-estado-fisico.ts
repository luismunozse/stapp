import { rgb, type PDFDocument, type PDFFont, type PDFPage } from "pdf-lib"
import { diagramaPorRef } from "@/components/ordenes/danos/diagramas"
import { TIPO_DANO_META } from "@/lib/ordenes/danos"
import { lineasEstadoFisico, type EstadoFisicoPDF } from "@/lib/ordenes/estado-fisico-lineas"
import { MONO } from "@/lib/pdf-style"
import { wrapPdfTexto } from "@/lib/pdf"

export { hayEstadoFisico, lineasEstadoFisico, TEXTO_SIN_DANOS, type EstadoFisicoPDF } from "@/lib/ordenes/estado-fisico-lineas"

/** Reemplaza por "?" lo que la fuente no puede codificar (emojis, etc.) para que drawText nunca tire. */
function textoSeguro(font: PDFFont, texto: string): string {
  let set: Set<number>
  try {
    set = new Set(font.getCharacterSet())
  } catch {
    return texto
  }
  return Array.from(texto.replace(/[\r\n\t]+/g, " "))
    .map((ch) => (set.has(ch.codePointAt(0)!) ? ch : "?"))
    .join("")
}

const SIZE_TITULO = 9
const SIZE_LISTA = 7.5
const LINE_H = 9.5
const MAX_VISTA_H = 100
const PIN_R = 5
const GAP_VISTAS = 10

function lineasAjustadas(lineas: string[], font: PDFFont, maxW: number): string[] {
  const salida: string[] = []
  for (const l of lineas) {
    const partes = wrapPdfTexto(textoSeguro(font, l), font, SIZE_LISTA, maxW)
    salida.push(...(partes.length ? partes : [""]))
  }
  return salida
}

function medirVistas(e: EstadoFisicoPDF, maxW: number) {
  const vistas = diagramaPorRef(e.diagrama).vistas.map((v) => {
    const [, , w, h] = v.viewBox.split(/\s+/).map(Number)
    return { v, w, h }
  })
  const sumW = vistas.reduce((a, x) => a + x.w, 0)
  const maxH = Math.max(...vistas.map((x) => x.h))
  const scale = Math.min((maxW - GAP_VISTAS * (vistas.length - 1)) / sumW, MAX_VISTA_H / maxH)
  return { vistas, scale, alto: maxH * scale }
}

/**
 * Dibuja el bloque "Estado físico al ingreso" con `box.y` como borde superior.
 * Devuelve la altura usada. Solo comandos simples de trazo: nunca se pasa `color` a
 * drawSvgPath (los subpaths abiertos se rellenarían como figuras cerradas).
 */
export function dibujarEstadoFisico(
  page: PDFPage,
  e: EstadoFisicoPDF,
  box: { x: number; y: number; w: number },
  fonts: { regular: PDFFont; bold: PDFFont },
): number {
  const { regular, bold } = fonts
  let y = box.y
  page.drawText("Estado físico al ingreso", { x: box.x, y: y - 8, size: SIZE_TITULO, font: bold, color: MONO.label })
  y -= 14

  const recepcion = lineasEstadoFisico(e, "recepcion")
  const hayPinsRecepcion = e.danos.some((d) => d.momento === "recepcion")
  const diag = e.danos.some((d) => d.momento === "diagnostico") ? lineasEstadoFisico(e, "diagnostico") : []

  if (!hayPinsRecepcion && diag.length === 0) {
    const lineas = lineasAjustadas(recepcion, regular, box.w)
    for (const l of lineas) {
      page.drawText(l, { x: box.x, y: y - 7, size: SIZE_LISTA + 0.5, font: regular, color: MONO.ink })
      y -= LINE_H + 1
    }
    return box.y - y + 2
  }

  const dibujoW = box.w * 0.55
  const listaX = box.x + dibujoW + 14
  const listaW = box.w - dibujoW - 14
  const { vistas, scale, alto } = medirVistas(e, dibujoW)

  // Vistas una al lado de la otra + pins numerados (todos los momentos, misma numeración que la lista).
  let vx = box.x
  for (const { v, w, h } of vistas) {
    page.drawSvgPath(v.paths.join(" "), { x: vx, y, scale, borderColor: MONO.ink, borderWidth: 0.8 })
    page.drawText(textoSeguro(regular, v.label), { x: vx, y: y - h * scale - 8, size: 6, font: regular, color: MONO.faint })
    for (const d of e.danos.filter((p) => p.vista === v.id)) {
      const cx = vx + Math.min(Math.max(d.x, 0), 1) * w * scale
      const cy = y - Math.min(Math.max(d.y, 0), 1) * h * scale
      const [r, g, b] = TIPO_DANO_META[d.tipo]?.pdfRgb ?? [0.28, 0.33, 0.41]
      page.drawCircle({ x: cx, y: cy, size: PIN_R, color: rgb(r, g, b), borderColor: rgb(1, 1, 1), borderWidth: 0.6 })
      const num = String(d.numero)
      const nw = bold.widthOfTextAtSize(num, 6)
      page.drawText(num, { x: cx - nw / 2, y: cy - 2.1, size: 6, font: bold, color: rgb(1, 1, 1) })
    }
    vx += w * scale + GAP_VISTAS
  }
  const dibujoH = alto + 12

  // Lista a la derecha.
  const lineasLista = lineasAjustadas(recepcion, regular, listaW)
  let ly = y
  for (const l of lineasLista) {
    page.drawText(l, { x: listaX, y: ly - 7, size: SIZE_LISTA, font: regular, color: MONO.ink })
    ly -= LINE_H
  }
  y -= Math.max(dibujoH, ly === y ? 0 : y - ly)

  // Pins que aparecieron en diagnóstico (bloque aparte, solo texto).
  if (diag.length > 0) {
    y -= 4
    page.drawText("Detectados en diagnóstico", { x: box.x, y: y - 7, size: SIZE_TITULO - 1, font: bold, color: MONO.label })
    y -= 12
    for (const l of lineasAjustadas(diag, regular, box.w)) {
      page.drawText(l, { x: box.x, y: y - 7, size: SIZE_LISTA, font: regular, color: MONO.ink })
      y -= LINE_H
    }
  }
  return box.y - y + 2
}

/** Altura que ocupará el bloque: lo dibuja en una página descartable del mismo documento y la quita. */
export function medirEstadoFisico(
  doc: PDFDocument,
  e: EstadoFisicoPDF,
  w: number,
  fonts: { regular: PDFFont; bold: PDFFont },
): number {
  const probe = doc.addPage([595, 842])
  try {
    return dibujarEstadoFisico(probe, e, { x: 0, y: 800, w }, fonts)
  } finally {
    doc.removePage(doc.getPageCount() - 1)
  }
}
