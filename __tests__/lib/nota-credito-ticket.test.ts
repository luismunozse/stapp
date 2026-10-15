import { describe, it, expect } from "vitest"
import { formatDateTimeValue } from "@/lib/timezone"
import { formatMontoTicket } from "@/lib/escpos"
import { ticketDesdeDocumento } from "@/lib/notas-credito/ticket"
import { buildNotaCreditoTicketHTML } from "@/components/notas-credito/nota-credito-ticket-html"
import type { NotaCreditoDocumento } from "@/lib/notas-credito/documento"

const doc: NotaCreditoDocumento = {
  id: "nc-o", origen: "ORDEN", origenId: "o-1", origenNumero: "CEL099", numero: "NC-000011",
  fecha: "2026-10-14T01:30:00+00:00", modo: "MONTO", motivoNc: null, detalle: "Producto con falla",
  observaciones: null, items: [], monto: 2000, montoAplicadoDeuda: 0, montoReembolso: 2000,
  metodo: "CREDITO_TIENDA", pendienteActual: 300, anulada: false, anuladaAt: null, anuladaMotivo: null,
  cliente: { nombre: "Juan Pérez", dni: null, telefono: null, email: null, direccion: null },
  sucursalNombre: null, atendidoPor: null,
  emisor: {
    nombreEmpresa: "Taller Sol", telefonoEmpresa: "011-4000-0000", direccionEmpresa: null,
    domicilioFiscalEmpresa: null, cuitEmpresa: null, condicionIvaEmpresa: null, pais: "AR",
    logoUrl: null, moneda: "ARS", zonaHoraria: "America/Argentina/Buenos_Aires",
  },
}

describe("ticketDesdeDocumento", () => {
  it("traduce códigos y fechas a lo que lee el cliente, en la zona de la organización", () => {
    const t = ticketDesdeDocumento(doc, new Date("2026-10-14T15:00:00Z"))
    expect(t).toEqual({
      numero: "NC-000011",
      // 01:30 UTC del 14 = 22:30 del 13 en Argentina.
      fecha: formatDateTimeValue("2026-10-14T01:30:00+00:00", "America/Argentina/Buenos_Aires"),
      hoy: "14/10/2026",
      origen: "ORDEN",
      operacion: "Orden CEL099",
      cliente: "Juan Pérez",
      motivo: "Producto con falla",
      items: [],
      monto: 2000,
      montoAplicadoDeuda: 0,
      montoReembolso: 2000,
      etiquetaReintegro: "Crédito a tu favor en el local",
      pendienteActual: 300,
      anulada: false,
      moneda: "ARS",
      nombreEmpresa: "Taller Sol",
      telefonoEmpresa: "011-4000-0000",
      direccionEmpresa: null,
    })
    expect(t.fecha).toContain("13/10/2026")
  })
})

describe("buildNotaCreditoTicketHTML", () => {
  const data = ticketDesdeDocumento(doc, new Date("2026-10-14T15:00:00Z"))

  it("arma la página del ancho elegido con número, montos y leyenda", () => {
    const html = buildNotaCreditoTicketHTML(data, { ancho: 80 })
    expect(html).toContain("@page { size: 80mm auto; margin: 0; }")
    expect(html).toContain("NOTA DE CRÉDITO")
    expect(html).toContain("NC-000011")
    expect(html).toContain("Orden CEL099")
    expect(html).toContain(formatMontoTicket(2000, "ARS"))
    expect(html).toContain("Crédito a tu favor en el local")
    expect(html).toContain("Saldo pendiente de la orden al 14/10/2026")
    expect(html).toContain("No válido como comprobante fiscal")
  })

  it("anulada lleva el sello", () => {
    expect(buildNotaCreditoTicketHTML({ ...data, anulada: true }, { ancho: 58 })).toContain("ANULADA")
  })

  // El nombre del cliente lo puede cargar un visitante anónimo desde el
  // catálogo público: el HTML se escribe con document.write en el origen de la app.
  it("escapa todo lo que viene de un usuario", () => {
    const html = buildNotaCreditoTicketHTML(
      { ...data, cliente: '<img src=x onerror="alert(1)">', motivo: "<script>x</script>", nombreEmpresa: "A&B" },
      { ancho: 58 }
    )
    expect(html).not.toContain("<img src=x")
    expect(html).not.toContain("<script>x</script>")
    expect(html).toContain("&lt;img")
    expect(html).toContain("A&amp;B")
  })

  it("lista los ítems cuando la NC es por productos", () => {
    const html = buildNotaCreditoTicketHTML(
      { ...data, items: [{ descripcion: "Funda", cantidad: 2, subtotal: 1500 }] },
      { ancho: 58 }
    )
    expect(html).toContain("Funda")
    expect(html).toContain("2 u.")
  })
})
