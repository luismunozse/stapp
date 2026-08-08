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

const OUT_DIR = ".tmp-preview/pdf-samples"
const TAG = process.env.PDF_SAMPLES_TAG ?? "after"

describe.runIf(process.env.PDF_SAMPLES === "1")("pdf visual samples", () => {
  it("writes orden and remito sample PDFs", async () => {
    mkdirSync(OUT_DIR, { recursive: true })

    const orden = await generateOrdenPDF({
      numeroOrden: 1042,
      fechaIngreso: new Date(),
      cliente: {
        nombre: "Juan Pérez",
        telefono: "+54 9 11 2345-6789",
        email: "juan.perez@example.com",
        direccion: "Av. Corrientes 1234, CABA",
      },
      dispositivo: "iPhone 13",
      tipoDispositivo: "CELULAR",
      marca: "Apple",
      color: "Negro",
      imei: "358400123456789",
      problemaReportado:
        "El equipo no enciende desde que se mojó levemente con la lluvia. Además, la pantalla parpadea de forma intermitente cada vez que se intenta reiniciarlo.",
      accesorios: "Cargador, funda, chip claro",
      codigoAccesoDispositivo: "Patrón: 1-2-5-8-9",
      presupuesto: 45000,
      sena: 10000,
      metodoPagoSena: "EFECTIVO",
      observaciones: "El cliente solicita que se lo contacte únicamente por WhatsApp.",
      nombreEmpresa: "Servicio Técnico Demo",
      telefonoEmpresa: "+54 11 4000-1234",
      direccionEmpresa: "Av. Rivadavia 5000, CABA",
      moneda: "ARS",
      zonaHoraria: "America/Argentina/Buenos_Aires",
      estado: "RECIBIDO",
      publicToken: "sample-public-token-1234",
      baseUrl: "https://demo.stapp.com.ar",
      checklistItems: [
        { label: "Pantalla táctil funciona", valor: true },
        { label: "Botón de encendido funciona", valor: true },
        { label: "Cámara trasera funciona", valor: false },
        { label: "Puerto de carga funciona", valor: false },
        { label: "Estado de la carcasa", valor: "Rayones leves en el borde superior" },
        { label: "Accesorios entregados por el cliente", valor: "Cargador original, funda transparente" },
      ],
      checklistNotas: "El cliente indica que el equipo se reinicia solo al usar la cámara.",
    })
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
})
