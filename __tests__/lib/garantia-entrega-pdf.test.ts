// @vitest-environment node
/**
 * Smoke coverage for generateGarantiaVentaPDF and generateComprobanteEntregaPDF,
 * written BEFORE the monochrome restyle (Phase 2, Task 3) as a safety net for
 * behavior/content — not colors — so it should pass unchanged both before and
 * after the restyle.
 *
 * Signature fields on both interfaces are decoded directly from a raw base64
 * string (Buffer.from(..., "base64") / atob(...)), not fetched as a URL, so
 * the fixtures below pass the 1x1 PNG base64 payload as-is rather than
 * wrapping it in a data: URL (that technique is reserved for logoUrl /
 * fotosIngreso-style fields that go through fetch()).
 */
import { describe, it, expect } from "vitest"
import {
  generateGarantiaVentaPDF,
  generateComprobanteEntregaPDF,
  type GarantiaVentaPDFData,
  type ComprobanteEntregaPDFData,
} from "@/lib/pdf"
import { extractPdfText } from "./pdf-text-helper"

// Minimal 1x1 PNG, reused as a stand-in signature image (same trick as
// orden-pdf.test.ts / pdf-samples.test.ts).
const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

function buildGarantiaFixture(): GarantiaVentaPDFData {
  return {
    numeroGarantia: "GAR-0015",
    venta: { numeroVenta: 42, fecha: new Date("2026-01-15") },
    cliente: { nombre: "Laura Fernández", telefono: "+54 9 11 5555-1234" },
    item: { descripcion: "PANTALLA IPHONE 13 OLED", cantidad: 1, marca: "Apple" },
    diasValidez: 90,
    fechaInicio: new Date("2026-01-15"),
    fechaVencimiento: new Date("2026-04-15"),
    nombreEmpresa: "Servicio Técnico Demo",
    telefonoEmpresa: "+54 11 4000-1234",
    direccionEmpresa: "Av. Rivadavia 5000, CABA",
    moneda: "ARS",
    zonaHoraria: "America/Argentina/Buenos_Aires",
    firmaEncargado: pngBase64,
    firmaEncargadoMime: "image/png",
    nombreEncargado: "Carlos Ruiz",
  }
}

function buildEntregaFixture(overrides: Partial<ComprobanteEntregaPDFData> = {}): ComprobanteEntregaPDFData {
  return {
    numeroOrden: 1042,
    fechaIngreso: new Date("2026-01-10"),
    fechaEntrega: new Date("2026-01-20"),
    cliente: { nombre: "Juan Pérez", telefono: "+54 9 11 2345-6789", email: "juan.perez@example.com" },
    dispositivo: "iPhone 13",
    tipoDispositivo: "CELULAR",
    marca: "Apple",
    problemaReportado: "No enciende desde que se mojó levemente con la lluvia.",
    diagnostico: "Oxidación en el conector de carga, reemplazo de placa.",
    firmaClienteEntrega: pngBase64,
    firmaClienteMime: "image/png",
    firmaEncargadoEntrega: pngBase64,
    firmaEncargadoMime: "image/png",
    entregadoPor: "María Gómez",
    notasEntrega: "Se entrega el equipo funcionando correctamente. Cliente conforme.",
    nombreEmpresa: "Servicio Técnico Demo",
    telefonoEmpresa: "+54 11 4000-1234",
    direccionEmpresa: "Av. Rivadavia 5000, CABA",
    moneda: "ARS",
    zonaHoraria: "America/Argentina/Buenos_Aires",
    ...overrides,
  }
}

describe("generateGarantiaVentaPDF", () => {
  it("renders all key sections with signature and encargado name", async () => {
    const buffer = await generateGarantiaVentaPDF(buildGarantiaFixture())
    const text = await extractPdfText(buffer)
    expect(text).toContain("CERTIFICADO DE GARANTÍA")
    expect(text).toContain("GAR-0015")
    expect(text).toContain("Laura Fernández")
    expect(text).toContain("PANTALLA IPHONE 13 OLED")
    expect(text).toContain("CONDICIONES DE LA GARANTÍA")
    expect(text).toContain("Carlos Ruiz")
    expect(buffer.length).toBeGreaterThan(1000)
  })

  it("renders without an encargado signature or optional company fields", async () => {
    const buffer = await generateGarantiaVentaPDF({
      numeroGarantia: "GAR-0016",
      venta: { numeroVenta: 43, fecha: new Date("2026-01-16") },
      cliente: { nombre: "Consumidor Final" },
      item: { descripcion: "BATERIA IPHONE 12", cantidad: 2 },
      diasValidez: 30,
      fechaInicio: new Date("2026-01-16"),
      fechaVencimiento: new Date("2026-02-15"),
    })
    const text = await extractPdfText(buffer)
    expect(text).toContain("CERTIFICADO DE GARANTÍA")
    expect(text).toContain("GAR-0016")
    expect(text).toContain("Consumidor Final")
    expect(text).toContain("BATERIA IPHONE 12")
    expect(buffer.length).toBeGreaterThan(1000)
  })
})

describe("generateComprobanteEntregaPDF", () => {
  it("renders the ENTREGA (repaired) variant with diagnostico and notas", async () => {
    const buffer = await generateComprobanteEntregaPDF(buildEntregaFixture())
    const text = await extractPdfText(buffer)
    expect(text).toContain("COMPROBANTE DE ENTREGA")
    expect(text).toContain("Juan Pérez")
    expect(text).toContain("iPhone 13")
    expect(text).toContain("María Gómez")
    expect(text).toContain("Oxidación en el conector de carga")
    expect(buffer.length).toBeGreaterThan(1000)
  })

  it("renders the RETIRO (unrepaired pickup) variant without diagnostico", async () => {
    const buffer = await generateComprobanteEntregaPDF(
      buildEntregaFixture({
        esRetiroSinReparacion: true,
        diagnostico: null,
        notasEntrega: null,
        problemaReportado: "Cliente decide no reparar por costo elevado.",
      })
    )
    const text = await extractPdfText(buffer)
    expect(text).toContain("ORDEN DE RETIRO")
    expect(text).toContain("Juan Pérez")
    expect(text).toContain("Cliente decide no reparar por costo elevado.")
    expect(buffer.length).toBeGreaterThan(1000)
  })
})
