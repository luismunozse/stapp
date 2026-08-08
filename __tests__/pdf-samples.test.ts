// @vitest-environment node
/**
 * Manual visual-sample generator. Skipped unless PDF_SAMPLES=1.
 * Usage: PDF_SAMPLES=1 PDF_SAMPLES_TAG=before npx vitest run __tests__/pdf-samples.test.ts
 *
 * Writes fully-populated orden and remito (factura) PDFs to
 * .tmp-preview/pdf-samples/{TAG}-orden.pdf and {TAG}-remito.pdf so the
 * monochrome redesign can be compared visually against a baseline.
 */
import { describe, it, expect } from "vitest"
import { mkdirSync, writeFileSync } from "node:fs"
import { generateOrdenPDF, generateFacturaPDF } from "@/lib/pdf"
import { buildOrdenFixture } from "./lib/orden-fixture"

const OUT_DIR = ".tmp-preview/pdf-samples"
const TAG = process.env.PDF_SAMPLES_TAG ?? "after"

describe.runIf(process.env.PDF_SAMPLES === "1")("pdf visual samples", () => {
  it("writes orden and remito sample PDFs", async () => {
    mkdirSync(OUT_DIR, { recursive: true })

    const orden = await generateOrdenPDF(buildOrdenFixture())
    writeFileSync(`${OUT_DIR}/${TAG}-orden.pdf`, orden)
    expect(orden.length).toBeGreaterThan(1000)

    const remito = await generateFacturaPDF({
      numeroFactura: "0001-00000007",
      fecha: new Date("2026-08-08"),
      estadoPago: "PAGADO_PARCIAL",
      cliente: { nombre: "Consumidor Final" },
      venta: { numeroVenta: 9 },
      items: [
        { descripcion: "PANTALLA IPHONE 13 OLED", cantidad: 1, precioUnitario: 45000, subtotal: 45000 },
        { descripcion: "BATERIA IPHONE 13", cantidad: 1, precioUnitario: 18000, subtotal: 18000 },
        { descripcion: "MANO DE OBRA REPARACION", cantidad: 1, precioUnitario: 12000, subtotal: 12000 },
      ],
      descuento: 5000,
      redondeo: 0.5,
      subtotal: 75000,
      iva: 0,
      total: 70000.5,
      montoAbonado: 40000,
      pagos: [
        { monto: 20000, metodoPago: "EFECTIVO", fecha: new Date("2026-08-01") },
        { monto: 15000, metodoPago: "TRANSFERENCIA", fecha: new Date("2026-08-03"), referencia: "TRF-00123" },
        {
          monto: 5000,
          metodoPago: "TARJETA_CREDITO",
          fecha: new Date("2026-08-05"),
          cuotas: 3,
          recargoPorcentaje: 10,
          montoOriginal: 4545.45,
        },
      ],
    })
    writeFileSync(`${OUT_DIR}/${TAG}-remito.pdf`, remito)
    expect(remito.length).toBeGreaterThan(1000)
  }, 60_000)

  it("writes an ENTREGADO orden sample (local copy, fotos, entrega pages)", async () => {
    mkdirSync(OUT_DIR, { recursive: true })

    // Minimal 1x1 PNG, embedded as a data: URL so the fotos-de-ingreso fetch
    // works offline, and reused as a stand-in signature image.
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

    const orden = await generateOrdenPDF({
      ...buildOrdenFixture(),
      estado: "ENTREGADO",
      fotosIngreso: [
        { url: `data:image/png;base64,${pngBase64}`, descripcion: "Pantalla con manchas de humedad" },
        { url: `data:image/png;base64,${pngBase64}`, descripcion: "Puerto de carga oxidado" },
      ],
      fechaEntrega: new Date(),
      firmaClienteEntrega: pngBase64,
      firmaEncargadoEntrega: pngBase64,
      entregadoPor: "María Gómez",
      notasEntrega: "Se entrega el equipo funcionando correctamente. Cliente conforme.",
    })
    writeFileSync(`${OUT_DIR}/${TAG}-orden-entregada.pdf`, orden)
    expect(orden.length).toBeGreaterThan(1000)
  }, 60_000)
})
