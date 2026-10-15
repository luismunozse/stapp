// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { formatCurrencyValue } from "@/lib/currency"
import { generateWhatsAppUrl } from "@/lib/notifications/whatsapp-templates"
import { mensajeNotaCredito, compartirNotaCredito, descargarPdfNotaCredito } from "@/lib/notas-credito/whatsapp"
import type { NotaCreditoDocumento } from "@/lib/notas-credito/documento"

const doc: NotaCreditoDocumento = {
  id: "nc-1", origen: "VENTA", origenId: "v-1", origenNumero: "V0042", numero: "NC-000010",
  fecha: "2026-10-13T15:00:00+00:00", modo: "ITEMS", motivoNc: "DEVOLUCION", detalle: null, observaciones: null,
  items: [], monto: 1500, montoAplicadoDeuda: 500, montoReembolso: 1000, metodo: "EFECTIVO",
  pendienteActual: 0, anulada: false, anuladaAt: null, anuladaMotivo: null,
  cliente: { nombre: "Juan Pérez", dni: null, telefono: "1155550000", email: null, direccion: null },
  sucursalNombre: null, atendidoPor: null,
  emisor: { nombreEmpresa: "Taller Sol", telefonoEmpresa: null, direccionEmpresa: null, domicilioFiscalEmpresa: null, cuitEmpresa: null, condicionIvaEmpresa: null, pais: "AR", logoUrl: null, moneda: "ARS", zonaHoraria: "America/Argentina/Buenos_Aires" },
}
const plata = (n: number) => formatCurrencyValue(n, "ARS")

describe("mensajeNotaCredito", () => {
  it("con la plantilla por defecto: cliente, número, operación, monto, importes y taller", () => {
    const m = mensajeNotaCredito(doc)
    expect(m).toContain("Hola Juan Pérez,")
    expect(m).toContain("NC-000010")
    expect(m).toContain("compra V0042")
    expect(m).toContain(plata(1500))
    expect(m).toContain(`Descontado de tu saldo pendiente: ${plata(500)}`)
    expect(m).toContain(`Te devolvimos (Efectivo): ${plata(1000)}`)
    expect(m).toContain("Taller Sol")
  })

  it("una NC de orden habla de la orden", () => {
    expect(mensajeNotaCredito({ ...doc, origen: "ORDEN", origenNumero: "CEL099" })).toContain("orden CEL099")
  })

  // Review Focus 2: venta de mostrador.
  it("a un consumidor final no le dice 'Hola Consumidor final'", () => {
    const m = mensajeNotaCredito({ ...doc, cliente: { ...doc.cliente, nombre: "Consumidor final" } })
    expect(m.startsWith("Hola,")).toBe(true)
    expect(m).not.toContain("Consumidor final")
  })

  it("usa el texto que el taller guardó", () => {
    const m = mensajeNotaCredito(doc, { nota_credito_comprobante: "NC {numero_nc} para {cliente}" })
    expect(m).toBe("NC NC-000010 para Juan Pérez")
  })

  it("usa la moneda de la organización", () => {
    const m = mensajeNotaCredito({ ...doc, emisor: { ...doc.emisor, moneda: "EUR" } })
    expect(m).toContain(formatCurrencyValue(1500, "EUR"))
  })
})

describe("descargarPdfNotaCredito", () => {
  it("trae el PDF de esa NC", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob(["%PDF"], { type: "application/pdf" }) })))
    const blob = await descargarPdfNotaCredito("nc-1")
    expect(fetch).toHaveBeenCalledWith("/api/notas-credito/nc-1/pdf")
    expect(blob.type).toBe("application/pdf")
  })

  it("si el PDF no sale, falla", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })))
    await expect(descargarPdfNotaCredito("nc-1")).rejects.toThrow("No se pudo generar el PDF")
  })
})

describe("compartirNotaCredito", () => {
  const pdf = new Blob(["%PDF"], { type: "application/pdf" })
  const opts = { numero: "NC-000010", telefono: "1155550000", pais: "AR", mensaje: "Hola", pdf }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("open", vi.fn(() => ({})))
    URL.createObjectURL = vi.fn(() => "blob:nc")
    URL.revokeObjectURL = vi.fn()
  })

  it("en el celular comparte el PDF como archivo con el texto (no hace falta teléfono)", async () => {
    const share = vi.fn(async () => {})
    Object.assign(navigator, { share, canShare: () => true })
    expect(await compartirNotaCredito({ ...opts, telefono: null })).toBe("compartido")
    const arg = (share.mock.calls[0] as unknown[])[0] as { text: string; files: File[] }
    expect(arg.text).toBe("Hola")
    expect(arg.files[0].name).toBe("nota-credito-NC-000010.pdf")
    expect(arg.files[0].type).toBe("application/pdf")
    expect(window.open).not.toHaveBeenCalled()
  })

  it("sin compartir nativo: descarga el PDF y abre WhatsApp con el texto", async () => {
    Object.assign(navigator, { share: undefined, canShare: undefined })
    expect(await compartirNotaCredito(opts)).toBe("whatsapp")
    expect(URL.createObjectURL).toHaveBeenCalled()
    expect(window.open).toHaveBeenCalledWith(generateWhatsAppUrl("1155550000", "Hola", "AR"), "_blank")
  })

  // Review Focus 2: sin teléfono no abre un WhatsApp sin destino.
  it("sin compartir nativo y sin teléfono: solo descarga", async () => {
    Object.assign(navigator, { share: undefined, canShare: undefined })
    expect(await compartirNotaCredito({ ...opts, telefono: null })).toBe("descargado")
    expect(window.open).not.toHaveBeenCalled()
  })

  // La hoja de compartir exige un gesto reciente: si el navegador la rechaza, el PDF no se pierde.
  it("si el navegador no deja compartir (NotAllowedError), cae a la descarga y abre WhatsApp", async () => {
    const share = vi.fn(async () => { throw Object.assign(new Error("no"), { name: "NotAllowedError" }) })
    Object.assign(navigator, { share, canShare: () => true })
    expect(await compartirNotaCredito(opts)).toBe("whatsapp")
    expect(URL.createObjectURL).toHaveBeenCalled()
    expect(window.open).toHaveBeenCalledWith(generateWhatsAppUrl("1155550000", "Hola", "AR"), "_blank")
  })

  it("NotAllowedError sin teléfono: solo descarga", async () => {
    const share = vi.fn(async () => { throw Object.assign(new Error("no"), { name: "NotAllowedError" }) })
    Object.assign(navigator, { share, canShare: () => true })
    expect(await compartirNotaCredito({ ...opts, telefono: null })).toBe("descargado")
  })

  it("cancelar la hoja de compartir sigue siendo un AbortError (no descarga)", async () => {
    const share = vi.fn(async () => { throw Object.assign(new Error("cancelado"), { name: "AbortError" }) })
    Object.assign(navigator, { share, canShare: () => true })
    await expect(compartirNotaCredito(opts)).rejects.toMatchObject({ name: "AbortError" })
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it("si el navegador bloquea la ventana de WhatsApp, lo informa (el PDF ya se descargó)", async () => {
    Object.assign(navigator, { share: undefined, canShare: undefined })
    vi.stubGlobal("open", vi.fn(() => null))
    expect(await compartirNotaCredito(opts)).toBe("bloqueado")
    expect(URL.createObjectURL).toHaveBeenCalled()
  })
})
