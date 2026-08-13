// @vitest-environment node
/**
 * Manual visual-sample generator. Skipped unless PDF_SAMPLES=1.
 * Usage: PDF_SAMPLES=1 PDF_SAMPLES_TAG=before npx vitest run __tests__/pdf-samples.test.ts
 *
 * Writes fully-populated orden, remito (factura), venta, devolucion,
 * cotizacion, garantia and standalone entrega PDFs to
 * .tmp-preview/pdf-samples/{TAG}-orden.pdf, {TAG}-remito.pdf,
 * {TAG}-venta.pdf, {TAG}-devolucion.pdf, {TAG}-garantia.pdf and
 * {TAG}-entrega-standalone.pdf so the monochrome redesign can be compared
 * visually against a baseline.
 */
import { describe, it, expect } from "vitest"
import { mkdirSync, writeFileSync } from "node:fs"
import { generateOrdenPDF, generateFacturaPDF, generateVentaPDF, generateVentaTicketPDF, generateDevolucionPDF, generateCotizacionPDF, generateGarantiaVentaPDF, generateComprobanteEntregaPDF } from "@/lib/pdf"
import { buildOrdenFixture } from "./lib/orden-fixture"
import { buildCotizacionOrdenFixture, buildCotizacionPresupuestoFixture } from "./lib/cotizacion-fixture"

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
      // Accounting-grade remito: goods moved a few days before emission.
      fechaOperacion: new Date("2026-08-05"),
      estadoPago: "PAGADO_PARCIAL",
      cliente: { nombre: "Consumidor Final", dni: "30.123.456" },
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
      nombreEmpresa: "Servicio Técnico Demo",
      telefonoEmpresa: "+54 11 4000-1234",
      direccionEmpresa: "Av. Rivadavia 5000, CABA",
      // Fiscal emitter identity — accounting-grade remito EMISOR extras.
      cuitEmpresa: "30-71234567-8",
      condicionIvaEmpresa: "Responsable Inscripto",
      domicilioFiscalEmpresa: "Av. Corrientes 3247, CABA",
      // Payment terms — CONDICIONES DE PAGO section.
      vencimiento: new Date("2026-08-20"),
      mediosPago: "Efectivo, transferencia, tarjeta",
      cbuAlias: "SERVICIO.TECNICO.MP",
    })
    writeFileSync(`${OUT_DIR}/${TAG}-remito.pdf`, remito)
    expect(remito.length).toBeGreaterThan(1000)

    // Long remito: overflows both the items table and the payment history
    // onto continuation pages (Task 7 — pagination replaced the old
    // single-page truncation for these two tables).
    // Orden-sourced (not venta-sourced, unlike the sample above) so this
    // document also exercises RECIBÍ CONFORME, which only draws when
    // data.orden is present — together with the saldo-column pagination
    // and CONDICIONES DE PAGO, all landing on continuation pages.
    const remitoLargo = await generateFacturaPDF({
      numeroFactura: "0001-00000008",
      fecha: new Date("2026-08-08"),
      fechaOperacion: new Date("2026-08-06"),
      estadoPago: "PAGADO_PARCIAL",
      cliente: { nombre: "Consumidor Final", dni: "27.998.765" },
      orden: { numeroOrden: 130, codigoOrden: "ORD-0130", dispositivo: "IPHONE 13 PRO MAX 256GB" },
      items: Array.from({ length: 40 }, (_, i) => ({
        descripcion: `REPUESTO DE PRUEBA ${String(i + 1).padStart(3, "0")}`,
        cantidad: 1,
        precioUnitario: 1000,
        subtotal: 1000,
      })),
      subtotal: 40000,
      iva: 0,
      total: 40000,
      montoAbonado: 15 * 500,
      pagos: Array.from({ length: 15 }, (_, i) => ({
        monto: 500,
        metodoPago: "EFECTIVO",
        fecha: new Date("2026-08-08"),
        referencia: `REF-PAGO-${String(i + 1).padStart(3, "0")}`,
      })),
      nombreEmpresa: "Servicio Técnico Demo",
      telefonoEmpresa: "+54 11 4000-1234",
      direccionEmpresa: "Av. Rivadavia 5000, CABA",
      cuitEmpresa: "30-71234567-8",
      condicionIvaEmpresa: "Responsable Inscripto",
      domicilioFiscalEmpresa: "Av. Corrientes 3247, CABA",
      vencimiento: new Date("2026-08-22"),
      mediosPago: "Efectivo, transferencia, tarjeta",
      cbuAlias: "SERVICIO.TECNICO.MP",
    })
    writeFileSync(`${OUT_DIR}/${TAG}-remito-largo.pdf`, remitoLargo)
    expect(remitoLargo.length).toBeGreaterThan(1000)
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

  it("writes venta and devolucion sample PDFs", async () => {
    mkdirSync(OUT_DIR, { recursive: true })

    const venta = await generateVentaPDF({
      numeroVenta: 128,
      fecha: new Date("2026-08-08"),
      cliente: { nombre: "Marcos Iglesias", telefono: "+54 9 11 6789-0123" },
      vendedor: "Sofía Herrera",
      items: [
        { descripcion: "IPHONE 13 128GB NEGRO", cantidad: 1, precioUnitario: 620000, subtotal: 620000, diasGarantia: 180 },
        { descripcion: "FUNDA SILICONA TRANSPARENTE", cantidad: 1, precioUnitario: 8000, subtotal: 8000, diasGarantia: 30 },
        { descripcion: "VIDRIO TEMPLADO PREMIUM", cantidad: 2, precioUnitario: 4500, subtotal: 9000, diasGarantia: 0 },
      ],
      subtotal: 637000,
      descuento: 12000,
      total: 625000,
      metodoPago: "TRANSFERENCIA",
      nombreEmpresa: "Servicio Técnico Demo",
      telefonoEmpresa: "+54 11 4000-1234",
      direccionEmpresa: "Av. Rivadavia 5000, CABA",
      moneda: "ARS",
      zonaHoraria: "America/Argentina/Buenos_Aires",
    })
    writeFileSync(`${OUT_DIR}/${TAG}-venta.pdf`, venta)
    expect(venta.length).toBeGreaterThan(1000)

    const devolucion = await generateDevolucionPDF({
      numeroDevolucion: "DEV-0042",
      fecha: new Date("2026-08-08"),
      ventaNumero: 128,
      motivo: "Producto con falla de fábrica",
      tipo: "REEMBOLSO",
      observaciones: "Cliente devuelve el vidrio templado por burbujas de aire visibles a los 2 días de uso.",
      items: [
        { descripcion: "VIDRIO TEMPLADO PREMIUM", cantidad: 2, precioUnitario: 4500, subtotal: 9000 },
      ],
      montoDevolucion: 9000,
      cliente: { nombre: "Marcos Iglesias", telefono: "+54 9 11 6789-0123" },
      nombreEmpresa: "Servicio Técnico Demo",
      telefonoEmpresa: "+54 11 4000-1234",
      direccionEmpresa: "Av. Rivadavia 5000, CABA",
      moneda: "ARS",
      zonaHoraria: "America/Argentina/Buenos_Aires",
    })
    writeFileSync(`${OUT_DIR}/${TAG}-devolucion.pdf`, devolucion)
    expect(devolucion.length).toBeGreaterThan(1000)
  }, 60_000)

  it("writes a thermal ticket sample PDF (58mm)", async () => {
    mkdirSync(OUT_DIR, { recursive: true })

    const ticket = await generateVentaTicketPDF(
      {
        numeroVenta: 128,
        fecha: new Date("2026-08-08"),
        cliente: { nombre: "Marcos Iglesias", telefono: "+54 9 11 6789-0123" },
        vendedor: "Sofía Herrera",
        items: [
          { descripcion: "IPHONE 13 128GB NEGRO", cantidad: 1, precioUnitario: 620000, subtotal: 620000, diasGarantia: 180 },
          { descripcion: "FUNDA SILICONA TRANSPARENTE", cantidad: 1, precioUnitario: 8000, subtotal: 8000, diasGarantia: 30 },
          { descripcion: "VIDRIO TEMPLADO PREMIUM", cantidad: 2, precioUnitario: 4500, subtotal: 9000, diasGarantia: 0 },
        ],
        subtotal: 637000,
        descuento: 12000,
        total: 625000,
        metodoPago: "TRANSFERENCIA",
        nombreEmpresa: "Servicio Técnico Demo",
        telefonoEmpresa: "+54 11 4000-1234",
        direccionEmpresa: "Av. Rivadavia 5000, CABA",
        moneda: "ARS",
        zonaHoraria: "America/Argentina/Buenos_Aires",
      },
      58
    )
    writeFileSync(`${OUT_DIR}/${TAG}-ticket.pdf`, ticket)
    expect(ticket.length).toBeGreaterThan(500)
  }, 60_000)

  it("writes cotizacion sample PDFs (both tipo variants)", async () => {
    mkdirSync(OUT_DIR, { recursive: true })

    const cotizacionOrden = await generateCotizacionPDF(buildCotizacionOrdenFixture())
    writeFileSync(`${OUT_DIR}/${TAG}-cotizacion-orden.pdf`, cotizacionOrden)
    expect(cotizacionOrden.length).toBeGreaterThan(1000)

    const cotizacionPresupuesto = await generateCotizacionPDF(buildCotizacionPresupuestoFixture())
    writeFileSync(`${OUT_DIR}/${TAG}-cotizacion-presupuesto.pdf`, cotizacionPresupuesto)
    expect(cotizacionPresupuesto.length).toBeGreaterThan(1000)
  }, 60_000)

  it("writes garantia and standalone entrega sample PDFs", async () => {
    mkdirSync(OUT_DIR, { recursive: true })

    // Minimal 1x1 PNG, reused as a stand-in signature image (same trick as
    // the ENTREGADO orden sample above).
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

    const garantia = await generateGarantiaVentaPDF({
      numeroGarantia: "GAR-0089",
      venta: { numeroVenta: 128, fecha: new Date("2026-08-08") },
      cliente: { nombre: "Marcos Iglesias", telefono: "+54 9 11 6789-0123" },
      item: { descripcion: "IPHONE 13 128GB NEGRO", cantidad: 1, marca: "Apple" },
      diasValidez: 180,
      fechaInicio: new Date("2026-08-08"),
      fechaVencimiento: new Date("2027-02-04"),
      nombreEmpresa: "Servicio Técnico Demo",
      telefonoEmpresa: "+54 11 4000-1234",
      direccionEmpresa: "Av. Rivadavia 5000, CABA",
      moneda: "ARS",
      zonaHoraria: "America/Argentina/Buenos_Aires",
      firmaEncargado: pngBase64,
      firmaEncargadoMime: "image/png",
      nombreEncargado: "Sofía Herrera",
    })
    writeFileSync(`${OUT_DIR}/${TAG}-garantia.pdf`, garantia)
    expect(garantia.length).toBeGreaterThan(1000)

    const entregaStandalone = await generateComprobanteEntregaPDF({
      numeroOrden: 1042,
      fechaIngreso: new Date("2026-07-28"),
      fechaEntrega: new Date("2026-08-08"),
      cliente: { nombre: "Juan Pérez", telefono: "+54 9 11 2345-6789", email: "juan.perez@example.com" },
      dispositivo: "iPhone 13",
      tipoDispositivo: "CELULAR",
      marca: "Apple",
      problemaReportado: "El equipo no enciende desde que se mojó levemente con la lluvia.",
      diagnostico: "Oxidación en el conector de carga. Se reemplazó la placa base.",
      firmaClienteEntrega: pngBase64,
      firmaClienteMime: "image/png",
      firmaEncargadoEntrega: pngBase64,
      firmaEncargadoMime: "image/png",
      entregadoPor: "María Gómez",
      notasEntrega: "Se entrega el equipo funcionando correctamente. Cliente conforme.",
      nombreEmpresa: "Servicio Técnico Demo",
      telefonoEmpresa: "+54 11 4000-1234",
      direccionEmpresa: "Av. Rivadavia 5000, CABA",
      ciudadEmpresa: "CABA",
      provinciaEmpresa: "Buenos Aires",
      moneda: "ARS",
      zonaHoraria: "America/Argentina/Buenos_Aires",
    })
    writeFileSync(`${OUT_DIR}/${TAG}-entrega-standalone.pdf`, entregaStandalone)
    expect(entregaStandalone.length).toBeGreaterThan(1000)
  }, 60_000)
})
