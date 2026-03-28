/**
 * ESC/POS command generator for 58mm thermal printers
 * Generates raw byte commands for silent printing via WebUSB
 *
 * 58mm printer = ~32 chars per line (normal font)
 * 80mm printer = ~48 chars per line (normal font)
 */

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
  CUT: [GS, 0x56, 0x41, 0x03], // Partial cut with feed
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
  add(CMD.ALIGN_LEFT)
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

  // Feed and cut
  add(CMD.FEED_5, CMD.CUT)

  return new Uint8Array(buf)
}
