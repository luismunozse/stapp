// @vitest-environment node
import { describe, it, expect } from "vitest"
import { PDFDocument } from "pdf-lib"
import { generateNotaCreditoPDF, type NotaCreditoPDFData } from "@/lib/nota-credito-react-pdf"
import { formatCurrencyValue } from "@/lib/currency"
import { formatDateValue } from "@/lib/timezone"
import { extractReactPdfText } from "./pdf-text-helper-react"

// Mismo criterio que cuenta-corriente-react-pdf.test.ts: Intl mete NBSP/NNBSP
// entre el símbolo y el número; se normalizan los dos lados.
const normalize = (s: string) => s.replace(/[  ]/g, " ")
const fmt = (n: number) => normalize(formatCurrencyValue(n, "ARS"))
const TZ = "America/Argentina/Buenos_Aires"

const base: NotaCreditoPDFData = {
  numero: "NC-000010",
  fecha: new Date("2026-10-13T15:00:00Z"),
  origen: "VENTA",
  operacion: "V0042",
  motivo: "Devolución de productos",
  detalle: "La funda vino fallada",
  items: [{ descripcion: "Funda silicona", cantidad: 2, precioUnitario: 750, subtotal: 1500 }],
  monto: 1500,
  montoAplicadoDeuda: 500,
  montoReembolso: 1000,
  etiquetaReintegro: "Te devolvimos (Efectivo)",
  pendienteActual: 1500,
  cliente: { nombre: "Juan Pérez", telefono: "1122334455" },
  nombreEmpresa: "Servicio Técnico SRL",
  moneda: "ARS",
  zonaHoraria: TZ,
}

const texto = async (data: NotaCreditoPDFData) => normalize(await extractReactPdfText(await generateNotaCreditoPDF(data)))

describe("generateNotaCreditoPDF", () => {
  it("renderiza una página A4 que se puede abrir", async () => {
    const doc = await PDFDocument.load(await generateNotaCreditoPDF(base))
    expect(doc.getPageCount()).toBe(1)
    const { width, height } = doc.getPage(0).getSize()
    expect(Math.round(width)).toBe(595)
    expect(Math.round(height)).toBe(842)
  })

  it("imprime título, número, emisor, cliente y operación de origen", async () => {
    const t = await texto(base)
    expect(t).toContain("NOTA DE CRÉDITO")
    expect(t).toContain("NC-000010")
    expect(t).toContain("Servicio Técnico SRL")
    expect(t).toContain("Juan Pérez")
    expect(t).toContain("Venta: V0042")
    expect(t).toContain(`Fecha: ${formatDateValue(base.fecha, TZ)}`)
  })

  it("por productos: imprime la tabla de lo devuelto", async () => {
    const t = await texto(base)
    expect(t).toContain("DESCRIPCIÓN")
    expect(t).toContain("Funda silicona")
    expect(t).toContain(fmt(750))
  })

  it("por monto: no imprime tabla", async () => {
    const t = await texto({ ...base, items: [], motivo: "Ajuste de precio", detalle: null })
    expect(t).not.toContain("DESCRIPCIÓN")
    expect(t).toContain("Ajuste de precio")
  })

  it("imprime el reparto con la voz del cliente y el total", async () => {
    const t = await texto(base)
    expect(t).toContain("Descontado de tu saldo pendiente")
    expect(t).toContain(fmt(500))
    expect(t).toContain("Te devolvimos (Efectivo)")
    expect(t).toContain(fmt(1000))
    expect(t).toContain("TOTAL ACREDITADO")
    expect(t).toContain(fmt(1500))
  })

  it("sin deuda descontada no imprime ese renglón; sin reintegro, tampoco el suyo", async () => {
    const soloDeuda = await texto({ ...base, montoAplicadoDeuda: 1500, montoReembolso: 0 })
    expect(soloDeuda).not.toContain("Te devolvimos")
    const soloReintegro = await texto({ ...base, montoAplicadoDeuda: 0, montoReembolso: 1500 })
    expect(soloReintegro).not.toContain("Descontado de tu saldo pendiente")
  })

  it("imprime el pendiente de hoy con su fecha", async () => {
    const hoy = formatDateValue(new Date(), TZ)
    expect(await texto(base)).toContain(`Saldo pendiente de la venta al ${hoy}: ${fmt(1500)}`)
    expect(await texto({ ...base, pendienteActual: 0 })).toContain(`Al ${hoy} la venta no tiene saldo pendiente.`)
    expect(await texto({ ...base, origen: "ORDEN", operacion: "CEL099", pendienteActual: 0 })).toContain(`Al ${hoy} la orden no tiene saldo pendiente.`)
  })

  it("sin pendiente (null) no dice nada del saldo de la operación", async () => {
    const t = await texto({ ...base, pendienteActual: null })
    expect(t).not.toContain("Saldo pendiente de la")
    expect(t).not.toContain("no tiene saldo pendiente")
  })

  it("una NC de orden nombra la orden", async () => {
    expect(await texto({ ...base, origen: "ORDEN", operacion: "CEL099" })).toContain("Orden: CEL099")
  })

  it("lleva la leyenda no fiscal y ya no se presenta como 'nota de crédito válida'", async () => {
    const t = await texto(base)
    expect(t).toContain("no válido como comprobante fiscal")
    expect(t.toLowerCase()).not.toContain("nota de crédito válida")
  })

  it("anulada: sello, fecha y motivo de la anulación", async () => {
    const anuladaAt = new Date("2026-10-14T12:00:00Z")
    const t = await texto({ ...base, anulada: true, anuladaAt, anuladaMotivo: "Error de carga" })
    expect(t).toContain("ANULADA")
    expect(t).toContain(`anulada el ${formatDateValue(anuladaAt, TZ)}`)
    expect(t).toContain("Motivo: Error de carga")
  })

  it("activa: no hay sello", async () => {
    expect(await texto(base)).not.toContain("ANULADA")
  })

  // Review Focus 1: historial DEV- sin motivo de catálogo y con medio viejo.
  it("una DEV- histórica imprime su número, el motivo libre una sola vez y el crédito en el local", async () => {
    const t = await texto({
      ...base,
      numero: "DEV-0042",
      motivo: "Producto con falla",
      detalle: "Producto con falla",
      etiquetaReintegro: "Crédito a tu favor en el local",
    })
    expect(t).toContain("DEV-0042")
    expect(t.split("Producto con falla").length - 1).toBe(1)
    expect(t).toContain("Crédito a tu favor en el local")
  })

  it("no filtra jerga interna ni valores vacíos al cliente", async () => {
    const t = await texto({ ...base, cliente: { nombre: null }, detalle: null, observaciones: null })
    for (const prohibido of ["ITEMS", "MONTO", "aplicado", "null", "undefined", "NaN"]) {
      expect(t).not.toContain(prohibido)
    }
    expect(t).toContain("Consumidor Final")
  })

  it("un reintegro sin medio registrado imprime el rótulo neutro, sin afirmar ni filtrar el código", async () => {
    const t = await texto({ ...base, etiquetaReintegro: "Reintegro" })
    expect(t).toContain("Reintegro")
    expect(t).not.toContain("Te devolvimos")
  })

  it("imprime las observaciones cuando las hay", async () => {
    expect(await texto({ ...base, observaciones: "Caja abierta, sin uso" })).toContain("Caja abierta, sin uso")
  })
})
