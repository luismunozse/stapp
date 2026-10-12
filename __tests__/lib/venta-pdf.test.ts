// @vitest-environment node
/**
 * Smoke coverage for generateVentaPDF and generateDevolucionPDF, written
 * BEFORE the monochrome restyle (Phase 2, Task 1) as a safety net for
 * behavior/content — not colors — so it should pass unchanged both before
 * and after the restyle.
 */
import { describe, it, expect } from "vitest"
import { generateVentaPDF, generateDevolucionPDF, type VentaPDFData, type DevolucionPDFData } from "@/lib/pdf"
import { extractPdfText } from "./pdf-text-helper"

function buildVentaFixture(): VentaPDFData {
  return {
    numeroVenta: 42,
    fecha: new Date("2026-01-15"),
    cliente: { nombre: "Laura Fernández", telefono: "+54 9 11 5555-1234" },
    vendedor: "Carlos Ruiz",
    items: [
      { descripcion: "PANTALLA IPHONE 13 OLED", cantidad: 1, precioUnitario: 45000, subtotal: 45000, diasGarantia: 90 },
      { descripcion: "FUNDA SILICONA NEGRA", cantidad: 2, precioUnitario: 2500, subtotal: 5000, diasGarantia: 0 },
    ],
    subtotal: 50000,
    descuento: 2000,
    total: 48000,
    metodoPago: "EFECTIVO",
    nombreEmpresa: "Servicio Técnico Demo",
    telefonoEmpresa: "+54 11 4000-1234",
    direccionEmpresa: "Av. Rivadavia 5000, CABA",
    moneda: "ARS",
    zonaHoraria: "America/Argentina/Buenos_Aires",
  }
}

function buildDevolucionFixture(): DevolucionPDFData {
  return {
    numeroDevolucion: "DEV-0007",
    fecha: new Date("2026-01-20"),
    ventaNumero: 42,
    motivo: "Producto defectuoso",
    tipo: "REEMBOLSO",
    observaciones: "Cliente reportó falla de pantalla a los 3 días.",
    items: [
      { descripcion: "PANTALLA IPHONE 13 OLED", cantidad: 1, precioUnitario: 45000, subtotal: 45000 },
    ],
    montoDevolucion: 45000,
    cliente: { nombre: "Laura Fernández", telefono: "+54 9 11 5555-1234" },
    nombreEmpresa: "Servicio Técnico Demo",
    telefonoEmpresa: "+54 11 4000-1234",
    direccionEmpresa: "Av. Rivadavia 5000, CABA",
    moneda: "ARS",
    zonaHoraria: "America/Argentina/Buenos_Aires",
  }
}

describe("generateVentaPDF", () => {
  it("renders all key sections", async () => {
    const buffer = await generateVentaPDF(buildVentaFixture())
    const text = await extractPdfText(buffer)
    expect(text).toContain("COMPROBANTE DE VENTA")
    expect(text).toContain("Laura Fernández")
    expect(text).toContain("PANTALLA IPHONE 13 OLED")
    expect(buffer.length).toBeGreaterThan(1000)
  })
})

describe("generateDevolucionPDF", () => {
  it("renders all key sections", async () => {
    const buffer = await generateDevolucionPDF(buildDevolucionFixture())
    const text = await extractPdfText(buffer)
    expect(text).toContain("NOTA DE CRÉDITO")
    expect(text).toContain("Laura Fernández")
    expect(text).toContain("PANTALLA IPHONE 13 OLED")
    expect(text).toContain("45.000")
    expect(buffer.length).toBeGreaterThan(1000)
  })
})
