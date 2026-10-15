import { describe, it, expect } from "vitest"
import { formatCurrencyValue } from "@/lib/currency"
import {
  textToBytes,
  formatMontoTicket,
  generateNotaCreditoTicketCommands,
  type NotaCreditoTicketData,
} from "@/lib/escpos"

const base: NotaCreditoTicketData = {
  numero: "NC-000010",
  fecha: "13/10/2026 12:00",
  hoy: "14/10/2026",
  origen: "VENTA",
  operacion: "Venta V0042",
  cliente: "Juan Pérez",
  motivo: "Devolución de productos",
  items: [{ descripcion: "Funda silicona", cantidad: 2, subtotal: 1500 }],
  monto: 1500,
  montoAplicadoDeuda: 500,
  montoReembolso: 1000,
  etiquetaReintegro: "Te devolvimos (Efectivo)",
  pendienteActual: 0,
  anulada: false,
  moneda: "ARS",
  nombreEmpresa: "Taller Sol",
  telefonoEmpresa: "011-4000-0000",
}

/** ¿El ticket contiene este texto, tal como lo manda a la impresora? */
function contiene(buf: Uint8Array, texto: string): boolean {
  const aguja = textToBytes(texto)
  outer: for (let i = 0; i <= buf.length - aguja.length; i++) {
    for (let j = 0; j < aguja.length; j++) if (buf[i + j] !== aguja[j]) continue outer
    return true
  }
  return false
}

/** Las líneas impresas, sin los comandos ESC/GS que las preceden. */
function lineas(buf: Uint8Array): string[] {
  const out: string[] = []
  let actual: number[] = []
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i]
    if (b === 0x1b) { i += buf[i + 1] === 0x40 ? 1 : 2; continue }
    if (b === 0x1d) { i += 3; continue }
    if (b === 0x0a) { out.push(String.fromCharCode(...actual)); actual = []; continue }
    actual.push(b)
  }
  return out
}

describe("formatMontoTicket", () => {
  it("formatea con la moneda de la organización sin espacios que la impresora no tiene", () => {
    const ars = formatMontoTicket(1500, "ARS")
    expect(ars).toBe(formatCurrencyValue(1500, "ARS").replace(/[  ]/g, " "))
    expect(ars).not.toMatch(/[  ]/)
  })

  // Review Focus 5: taller en España.
  it("un taller en EUR imprime euros", () => {
    const eur = formatMontoTicket(1500, "EUR")
    expect(eur).toContain("€")
    expect(eur).not.toContain("$")
    expect(eur).not.toMatch(/[  ]/)
  })

  it("sin moneda usa la de Argentina", () => {
    expect(formatMontoTicket(10, null)).toBe(formatMontoTicket(10, "ARS"))
  })
})

describe("generateNotaCreditoTicketCommands", () => {
  it("imprime título, número, operación, cliente, motivo e ítems", () => {
    const t = generateNotaCreditoTicketCommands(base, 58)
    for (const s of ["Taller Sol", "NOTA DE CRÉDITO", "NC-000010", "Venta V0042", "Juan Pérez", "Devolución de productos", "Funda silicona"]) {
      expect(contiene(t, s), s).toBe(true)
    }
  })

  it("imprime el reparto con la voz del cliente, el total y el pendiente de hoy", () => {
    const t = generateNotaCreditoTicketCommands({ ...base, pendienteActual: 200 }, 80)
    expect(contiene(t, "Descontado de tu saldo:")).toBe(true)
    expect(contiene(t, formatMontoTicket(500, "ARS"))).toBe(true)
    expect(contiene(t, "Te devolvimos (Efectivo)")).toBe(true)
    expect(contiene(t, formatMontoTicket(1000, "ARS"))).toBe(true)
    expect(contiene(t, formatMontoTicket(1500, "ARS"))).toBe(true)
    expect(contiene(t, "Saldo pendiente de la venta")).toBe(true)
    expect(contiene(t, "al 14/10/2026")).toBe(true)
  })

  it("sin pendiente (null) no imprime ese renglón", () => {
    const t = generateNotaCreditoTicketCommands({ ...base, pendienteActual: null }, 58)
    expect(contiene(t, "Saldo pendiente")).toBe(false)
    expect(contiene(t, "no tiene saldo")).toBe(false)
  })

  it("anulada lleva el sello", () => {
    expect(contiene(generateNotaCreditoTicketCommands({ ...base, anulada: true }, 58), "ANULADA")).toBe(true)
    expect(contiene(generateNotaCreditoTicketCommands(base, 58), "ANULADA")).toBe(false)
  })

  it("lleva la leyenda no fiscal y termina con el corte", () => {
    // 80 mm: en 58 la leyenda (33 caracteres) se parte en dos renglones.
    const t = generateNotaCreditoTicketCommands(base, 80)
    expect(contiene(t, "Nota de crédito interna")).toBe(true)
    expect(contiene(t, "No válido como comprobante fiscal")).toBe(true)
    expect(contiene(generateNotaCreditoTicketCommands(base, 58), "No válido como comprobante")).toBe(true)
    expect(Array.from(t.slice(-4))).toEqual([0x1d, 0x56, 0x41, 0x03])
  })

  it.each([[58, 32], [80, 48]] as const)("en %imm ninguna línea pasa de %i caracteres, aun con textos largos", (ancho, w) => {
    const t = generateNotaCreditoTicketCommands(
      {
        ...base,
        cliente: "Distribuidora Mayorista del Litoral Argentino Sociedad Anónima",
        motivo: "El cliente devolvió el equipo porque no encendía después de la reparación del conector",
        etiquetaReintegro: "Crédito a tu favor en el local",
        items: [{ descripcion: "Pantalla OLED original Samsung Galaxy S23 Ultra con marco", cantidad: 1, subtotal: 450000 }],
        monto: 450000,
        montoReembolso: 450000,
        montoAplicadoDeuda: 0,
      },
      ancho
    )
    for (const l of lineas(t)) expect(l.length, l).toBeLessThanOrEqual(w)
  })

  // Review Focus 5.
  it("en EUR manda el € de la code page y ningún '?' por caracteres sin mapear", () => {
    const t = generateNotaCreditoTicketCommands({ ...base, moneda: "EUR" }, 58)
    expect(Array.from(t)).toContain(0xd5)
    expect(Array.from(t)).not.toContain(0x3f)
  })
})
