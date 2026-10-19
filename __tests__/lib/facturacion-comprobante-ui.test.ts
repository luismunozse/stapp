// __tests__/lib/facturacion-comprobante-ui.test.ts
import { describe, it, expect } from "vitest"
import {
  etiquetaEstadoComprobante,
  fechaFiscalDMA,
  pdfComprobanteHref,
  tituloComprobante,
} from "@/lib/facturacion/comprobante-ui"

describe("etiquetaEstadoComprobante", () => {
  it("traduce cada estado a lenguaje de taller", () => {
    expect(etiquetaEstadoComprobante("emitido")).toBe("Emitida")
    expect(etiquetaEstadoComprobante("pendiente")).toBe("En proceso")
    expect(etiquetaEstadoComprobante("rechazado")).toBe("Rechazada")
  })
  it("un estado desconocido se muestra tal cual", () => {
    expect(etiquetaEstadoComprobante("raro")).toBe("raro")
  })
})

describe("fechaFiscalDMA", () => {
  it("formatea fechas ISO y compactas sin pasar por zona horaria", () => {
    expect(fechaFiscalDMA("2026-10-19")).toBe("19/10/2026")
    expect(fechaFiscalDMA("20261029")).toBe("29/10/2026")
  })
  it("vacio o formato desconocido", () => {
    expect(fechaFiscalDMA(null)).toBe("-")
    expect(fechaFiscalDMA("")).toBe("-")
    expect(fechaFiscalDMA("mañana")).toBe("mañana")
  })
})

describe("tituloComprobante", () => {
  it("arma 'Factura B 0001-00000007'", () => {
    expect(tituloComprobante("B", "0001-00000007")).toBe("Factura B 0001-00000007")
  })
  it("sin numero (pendiente o rechazado) solo el tipo", () => {
    expect(tituloComprobante("C", null)).toBe("Factura C")
  })
})

describe("pdfComprobanteHref", () => {
  it("apunta a la ruta de PDF del comprobante", () => {
    expect(pdfComprobanteHref("abc")).toBe("/api/facturacion-electronica/comprobantes/abc/pdf")
  })
})
