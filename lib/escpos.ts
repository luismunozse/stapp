/**
 * ESC/POS command generator for 58mm thermal printers
 * Generates raw byte commands for silent printing via WebUSB
 *
 * 58mm printer = ~32 chars per line (normal font)
 * 80mm printer = ~48 chars per line (normal font)
 */

import { resolveTerminologia, t, type Terminologia } from "@/lib/terminologia"

const CHARS_PER_LINE_58 = 32
const CHARS_PER_LINE_80 = 48

// ESC/POS command constants
const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

const CMD = {
  INIT: [ESC, 0x40], // Initialize printer
  CHARSET_LATIN: [ESC, 0x74, 0x13], // Code page 858 (Latin with €)
  ALIGN_LEFT: [ESC, 0x61, 0x00],
  ALIGN_CENTER: [ESC, 0x61, 0x01],
  ALIGN_RIGHT: [ESC, 0x61, 0x02],
  BOLD_ON: [ESC, 0x45, 0x01],
  BOLD_OFF: [ESC, 0x45, 0x00],
  DOUBLE_ON: [ESC, 0x21, 0x30], // Double width + height
  DOUBLE_OFF: [ESC, 0x21, 0x00],
  UNDERLINE_ON: [ESC, 0x2d, 0x01],
  UNDERLINE_OFF: [ESC, 0x2d, 0x00],
  CUT: [GS, 0x56, 0x41, 0x03], // Partial cut with minimal feed for cutter clearance
  FEED_1: [ESC, 0x64, 0x01], // Feed 1 line
  FEED_2: [ESC, 0x64, 0x02], // Feed 2 lines
  FEED_3: [ESC, 0x64, 0x03], // Feed 3 lines
  FEED_5: [ESC, 0x64, 0x05], // Feed 5 lines
}

// Convert text to Latin-1 bytes (handles Spanish chars)
function textToBytes(text: string): number[] {
  const bytes: number[] = []
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    // Map common Spanish/Latin chars to Latin-1
    if (code <= 0xff) {
      bytes.push(code)
    } else {
      bytes.push(0x3f) // '?' for unmapped chars
    }
  }
  return bytes
}

function line(text: string): number[] {
  return [...textToBytes(text), LF]
}

function separator(charCount: number, char = "-"): number[] {
  return line(char.repeat(charCount))
}

function doubleSeparator(charCount: number): number[] {
  return line("=".repeat(charCount))
}

// Pad text to fill line: left text ... right text
function columns(left: string, right: string, width: number): number[] {
  const gap = width - left.length - right.length
  if (gap <= 0) {
    return line(left.substring(0, width - right.length - 1) + " " + right)
  }
  return line(left + " ".repeat(gap) + right)
}

// Right-align text within width
function rightAlign(text: string, width: number): number[] {
  const pad = Math.max(0, width - text.length)
  return line(" ".repeat(pad) + text)
}

interface TicketItem {
  descripcion: string
  cantidad: number
  precioUnitario: number
  subtotal: number
  diasGarantia: number
}

interface TicketData {
  numeroVenta: number
  fecha: string
  cliente: { nombre: string; telefono?: string | null }
  vendedor: string
  items: TicketItem[]
  subtotal: number
  descuento: number
  total: number
  metodoPago: string
  nombreEmpresa?: string
  telefonoEmpresa?: string | null
  direccionEmpresa?: string | null
}

const METODO_LABELS: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA: "Tarjeta",
  TARJETA_DEBITO: "T. Debito",
  TARJETA_CREDITO: "T. Credito",
  MERCADOPAGO: "MercadoPago",
  CUENTA_CORRIENTE: "Cta. Cte.",
  OTRO: "Otro",
}

function formatMoney(amount: number): string {
  return "$" + amount.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

/**
 * Generate ESC/POS native QR code commands (GS ( k).
 * Most thermal printers support this. Renders crisp QR.
 */
function qrCommands(data: string, size: number = 7): number[] {
  const out: number[] = []
  // Model 2
  out.push(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00)
  // Size (1-16, default 7 ~ medium)
  const s = Math.max(1, Math.min(16, size))
  out.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, s)
  // Error correction M (49)
  out.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x49)
  // Store data
  const bytes = textToBytes(data)
  const len = bytes.length + 3
  const pL = len & 0xff
  const pH = (len >> 8) & 0xff
  out.push(GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30, ...bytes)
  // Print
  out.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30)
  return out
}

// Wrap text into lines of max `width` chars
function wrapText(text: string, width: number): string[] {
  const words = text.split(" ")
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    if (word.length > width) {
      if (current) { lines.push(current); current = "" }
      for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width))
    } else if ((current + (current ? " " : "") + word).length <= width) {
      current = current ? current + " " + word : word
    } else {
      if (current) lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines
}

export interface OrdenTicketData {
  numeroOrden: number
  codigoOrden?: string | null
  fechaIngreso: string
  estado: string
  cliente: { nombre: string; telefono?: string | null }
  dispositivo: string
  marca?: string | null
  color?: string | null
  imei?: string | null
  accesorios?: string | null
  problemaReportado: string
  presupuesto?: number | null
  costoFinal?: number | null
  fechaPrometida?: string | null
  observaciones?: string | null
  nombreEmpresa?: string
  telefonoEmpresa?: string | null
  direccionEmpresa?: string | null
  /** Pre-rasterized logo bytes (use imageUrlToRaster from lib/escpos-image.ts) */
  logoRaster?: Uint8Array | null
  /** URL for tracking QR (printed near footer) */
  qrUrl?: string | null
  /** Custom terms and conditions printed at the bottom */
  terminosCondiciones?: string | null
}

export function generateOrdenTicketCommands(
  data: OrdenTicketData,
  printerWidth: 58 | 80 = 80,
  terminologia?: Terminologia,
): Uint8Array {
  const term = terminologia ?? resolveTerminologia(null)
  const W = printerWidth === 58 ? CHARS_PER_LINE_58 : CHARS_PER_LINE_80
  const buf: number[] = []

  const add = (...cmds: number[][]) => { for (const cmd of cmds) buf.push(...cmd) }

  add(CMD.INIT, CMD.CHARSET_LATIN)

  // === LOGO (optional) ===
  if (data.logoRaster && data.logoRaster.length > 0) {
    buf.push(...Array.from(data.logoRaster))
  }

  // === HEADER ===
  add(CMD.ALIGN_CENTER, CMD.BOLD_ON, CMD.DOUBLE_ON)
  add(line((data.nombreEmpresa || "Servicio Tecnico").substring(0, W / 2)))
  add(CMD.DOUBLE_OFF, CMD.BOLD_OFF)
  if (data.telefonoEmpresa) add(line(`Tel: ${data.telefonoEmpresa}`))
  if (data.direccionEmpresa) add(line(data.direccionEmpresa.substring(0, W)))
  add(doubleSeparator(W))

  // === ORDEN NUMBER ===
  add(CMD.BOLD_ON, CMD.DOUBLE_ON)
  add(line(t(term, "orden").toUpperCase()))
  add(CMD.DOUBLE_OFF, CMD.BOLD_OFF)

  const ordenCode = data.codigoOrden || `#${String(data.numeroOrden).padStart(4, "0")}`
  add(CMD.BOLD_ON)
  add(line(ordenCode))
  add(CMD.BOLD_OFF)
  add(line(data.fechaIngreso))
  add(columns("Estado:", data.estado.substring(0, W - 9), W))
  add(separator(W))

  // === CLIENTE ===
  add(CMD.BOLD_ON)
  add(line("CLIENTE"))
  add(CMD.BOLD_OFF)
  add(line(data.cliente.nombre.substring(0, W)))
  if (data.cliente.telefono) add(columns("Tel:", data.cliente.telefono, W))
  add(separator(W))

  // === DISPOSITIVO ===
  add(CMD.BOLD_ON)
  add(line(t(term, "equipo").toUpperCase()))
  add(CMD.BOLD_OFF)
  add(line(data.dispositivo.substring(0, W)))
  if (data.marca) add(columns("Marca:", data.marca.substring(0, W - 8), W))
  if (data.color) add(columns("Color:", data.color.substring(0, W - 8), W))
  if (data.imei) add(columns(t(term, "serie") + ":", data.imei.substring(0, W - 7), W))
  if (data.accesorios) {
    add(line("Accesorios:"))
    for (const l of wrapText(data.accesorios, W)) add(line(" " + l))
  }
  add(separator(W))

  // === PROBLEMA ===
  add(CMD.BOLD_ON)
  add(line("PROBLEMA REPORTADO"))
  add(CMD.BOLD_OFF)
  for (const l of wrapText(data.problemaReportado, W)) add(line(l))

  if (data.observaciones) {
    add(separator(W, "-"))
    add(CMD.BOLD_ON)
    add(line("Observaciones:"))
    add(CMD.BOLD_OFF)
    for (const l of wrapText(data.observaciones, W)) add(line(l))
  }
  add(separator(W))

  // === PRESUPUESTO / FECHAS ===
  const hasBudget = data.presupuesto != null || data.costoFinal != null
  const hasFecha = !!data.fechaPrometida

  if (hasBudget || hasFecha) {
    if (data.presupuesto != null) {
      add(CMD.BOLD_ON)
      add(columns("Presupuesto:", formatMoney(data.presupuesto), W))
      add(CMD.BOLD_OFF)
    }
    if (data.costoFinal != null) {
      add(CMD.BOLD_ON)
      add(columns("Costo final:", formatMoney(data.costoFinal), W))
      add(CMD.BOLD_OFF)
    }
    if (hasFecha) {
      add(columns("Entrega est.:", data.fechaPrometida!.substring(0, W - 14), W))
    }
    add(separator(W))
  }

  // === QR SEGUIMIENTO (optional) ===
  if (data.qrUrl) {
    add(CMD.ALIGN_CENTER)
    add(CMD.BOLD_ON)
    add(line("SEGUIMIENTO ONLINE"))
    add(CMD.BOLD_OFF)
    add(line("Escanea para ver el estado"))
    buf.push(...qrCommands(data.qrUrl, 7))
    add(separator(W))
  }

  // === TERMINOS Y CONDICIONES ===
  if (data.terminosCondiciones) {
    add(CMD.ALIGN_CENTER)
    add(CMD.BOLD_ON)
    add(line("TERMINOS Y CONDICIONES"))
    add(CMD.BOLD_OFF)
    for (const l of wrapText(data.terminosCondiciones, W)) add(line(l))
    add(separator(W))
  }

  // === FOOTER ===
  add(CMD.ALIGN_CENTER)
  add(CMD.BOLD_ON)
  add(line("Conserve este comprobante"))
  add(CMD.BOLD_OFF)
  if (data.telefonoEmpresa) add(line(`Consultas: ${data.telefonoEmpresa}`))

  add(CMD.CUT)
  return new Uint8Array(buf)
}

export function generateTicketCommands(data: TicketData, printerWidth: 58 | 80 = 58): Uint8Array {
  const W = printerWidth === 58 ? CHARS_PER_LINE_58 : CHARS_PER_LINE_80
  const buf: number[] = []

  const add = (...cmds: number[][]) => {
    for (const cmd of cmds) buf.push(...cmd)
  }

  // Initialize
  add(CMD.INIT, CMD.CHARSET_LATIN)

  // === HEADER: Empresa ===
  add(CMD.ALIGN_CENTER, CMD.BOLD_ON, CMD.DOUBLE_ON)
  add(line((data.nombreEmpresa || "Servicio Tecnico").substring(0, W / 2)))
  add(CMD.DOUBLE_OFF, CMD.BOLD_OFF)

  if (data.telefonoEmpresa) {
    add(line(`Tel: ${data.telefonoEmpresa}`))
  }
  if (data.direccionEmpresa) {
    add(line(data.direccionEmpresa.substring(0, W)))
  }

  add(doubleSeparator(W))

  // === VENTA NUMBER ===
  add(CMD.BOLD_ON, CMD.DOUBLE_ON)
  add(line(`VENTA #${String(data.numeroVenta).padStart(4, "0")}`))
  add(CMD.DOUBLE_OFF, CMD.BOLD_OFF)
  add(line(data.fecha))
  add(separator(W))

  // === CLIENTE + VENDEDOR ===
  const clienteName = data.cliente.nombre || "Consumidor Final"
  add(columns("Cliente:", clienteName.substring(0, W - 10), W))
  if (data.cliente.telefono) {
    add(columns("Tel:", data.cliente.telefono, W))
  }
  add(columns("Vendedor:", data.vendedor.substring(0, W - 11), W))
  add(separator(W))

  // === ITEMS ===
  add(CMD.BOLD_ON)
  add(columns("PRODUCTO", "TOTAL", W))
  add(CMD.BOLD_OFF)
  add(separator(W, "-"))

  for (const item of data.items) {
    // Product name (truncate to fit)
    const name = item.descripcion.substring(0, W)
    add(CMD.BOLD_ON)
    add(line(name))
    add(CMD.BOLD_OFF)

    // Quantity x price = subtotal
    const detail = ` ${item.cantidad} x ${formatMoney(item.precioUnitario)}`
    const sub = formatMoney(item.subtotal)
    add(columns(detail, sub, W))

    // Warranty
    if (item.diasGarantia > 0) {
      add(line(` Garantia: ${item.diasGarantia} dias`))
    }
  }

  add(doubleSeparator(W))

  // === TOTALES ===
  add(columns("Subtotal:", formatMoney(data.subtotal), W))

  if (data.descuento > 0) {
    add(columns("Descuento:", `-${formatMoney(data.descuento)}`, W))
  }

  add(CMD.BOLD_ON, CMD.DOUBLE_ON)
  const totalStr = formatMoney(data.total)
  add(columns("TOTAL:", totalStr, W / 2))
  add(CMD.DOUBLE_OFF, CMD.BOLD_OFF)

  add(separator(W))

  // Metodo de pago
  const metodoLabel = METODO_LABELS[data.metodoPago] || data.metodoPago
  add(columns("Pago:", metodoLabel, W))

  add(doubleSeparator(W))

  // === FOOTER ===
  add(CMD.ALIGN_CENTER)
  add(CMD.BOLD_ON)
  add(line("Gracias por su compra!"))
  add(CMD.BOLD_OFF)
  add(line("Conserve este ticket"))
  add(line("como comprobante"))

  // Cut (cut command provides minimal feed for cutter clearance)
  add(CMD.CUT)

  return new Uint8Array(buf)
}
