/**
 * Shared, fully-populated `generateCotizacionPDF` fixtures for both `tipo`
 * variants. Used by cotizacion-pdf.test.ts and the manual visual-sample
 * generator in pdf-samples.test.ts so there is a single source of truth for
 * "what a real cotizacion PDF's input looks like".
 */
import type { CotizacionPDFData } from "@/lib/pdf"

const BASE_COMPANY = {
  nombreEmpresa: "Servicio Técnico Demo",
  telefonoEmpresa: "+54 11 4000-1234",
  direccionEmpresa: "Av. Rivadavia 5000, CABA",
  moneda: "ARS",
  zonaHoraria: "America/Argentina/Buenos_Aires",
}

// tipo: "ORDEN" — cotización ligada a una orden existente. Sin equipo,
// checklist ni condiciones (esas ya se relevaron en la recepción de la
// orden). Ejercita: fila IVA, descuento por item, banner de vencimiento.
export function buildCotizacionOrdenFixture(): CotizacionPDFData {
  return {
    numeroCotizacion: "COT-0021",
    fecha: new Date("2026-01-10"),
    fechaVencimiento: new Date("2026-01-24"),
    cliente: {
      nombre: "Roberto Gómez",
      telefono: "+54 9 11 4321-8765",
      email: "roberto.gomez@example.com",
    },
    tipo: "ORDEN",
    orden: {
      numeroOrden: 987,
      dispositivo: "iPhone 12",
      problemaReportado: "Pantalla no responde al tacto en la zona inferior.",
    },
    items: [
      { descripcion: "PANTALLA IPHONE 12 OLED", cantidad: 1, precioUnitario: 60000, subtotal: 60000 },
      {
        descripcion: "MANO DE OBRA",
        cantidad: 1,
        precioUnitario: 15000,
        subtotal: 15000,
        descuentoTipo: "porcentaje",
        descuentoValor: 10,
      },
    ],
    subtotal: 75000,
    ivaPorcentaje: 21,
    iva: 15750,
    total: 90750,
    notas: "El cliente autoriza el diagnóstico completo del equipo.",
    terminos: "La cotización no incluye daños adicionales detectados durante la reparación.",
    ...BASE_COMPANY,
  }
}

// tipo: "PRESUPUESTO" — cotización con card de equipo, checklist de
// recepción, condiciones técnicas y firma de aprobación del cliente.
export function buildCotizacionPresupuestoFixture(): CotizacionPDFData {
  // Minimal 1x1 PNG, embedded as base64 — same trick as orden-fixture's
  // fotos/firmas so the signature-embedding path works offline.
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

  return {
    numeroCotizacion: "COT-0022",
    fecha: new Date("2026-01-12"),
    fechaVencimiento: new Date("2026-01-26"),
    cliente: {
      nombre: "Valentina Ríos",
      telefono: "+54 9 11 9876-5432",
    },
    tipo: "PRESUPUESTO",
    equipo: {
      dispositivo: "Samsung Galaxy S22",
      tipoDispositivo: "CELULAR",
      marca: "Samsung",
      modelo: "S22",
      color: "Negro",
      imei: "358400123456999",
      problemaReportado: "No enciende luego de una caída al agua.",
    },
    checklist: {
      items: [
        { label: "Pantalla con rayones", valor: "Sí, borde superior", categoria: "CONDICION_FISICA" },
        { label: "Cargador entregado", valor: "Sí", categoria: "ACCESORIOS" },
        { label: "Estado de la batería", valor: "Se hincha levemente" },
      ],
      notas: "El cliente indica que el equipo estuvo sumergido por unos segundos.",
    },
    condiciones: {
      diagnostico: "Posible daño por líquido en la placa lógica.",
      plazoEstimadoDias: 5,
      anticipoTipo: "porcentaje",
      anticipoValor: 30,
      garantiaDias: 60,
      garantiaAlcance: "AMBOS",
      politicaAbandonoDias: 90,
    },
    items: [
      { descripcion: "LIMPIEZA POR LIQUIDO", cantidad: 1, precioUnitario: 20000, subtotal: 20000 },
      { descripcion: "BATERIA GALAXY S22", cantidad: 1, precioUnitario: 25000, subtotal: 25000, tipoRepuesto: "ALTERNATIVO" },
    ],
    subtotal: 45000,
    iva: 0,
    total: 40000,
    descuentoGlobalTipo: "fijo",
    descuentoGlobalValor: 5000,
    firmaAprobacion: pngBase64,
    firmaMime: "image/png",
    fechaAprobacion: new Date("2026-01-13"),
    ...BASE_COMPANY,
  }
}
