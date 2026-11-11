// @vitest-environment node
/**
 * Un nombre de empresa largo no puede pisar el bloque del documento (VENTA,
 * GARANTÍA, ENTREGA, COTIZACIÓN) en el encabezado de los comprobantes de
 * pdf-lib: se achica hasta 11pt y, si no entra, se corta con "…".
 */
import { describe, it, expect, beforeAll } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"
import fontkitModule from "@pdf-lib/fontkit"
import { PDFDocument, type PDFFont } from "pdf-lib"
import { generateCotizacionPDF, generateVentaPDF, generateGarantiaVentaPDF, generateComprobanteEntregaPDF } from "@/lib/pdf"
import { extractPdfTextPositions } from "./pdf-text-helper"
import { buildCotizacionPresupuestoFixture } from "./cotizacion-fixture"

const NOMBRE_LARGO = "Servicio Técnico Integral Hermanos Rodríguez y Asociados Sociedad de Responsabilidad Limitada"
const DIRECCION_LARGA = "Avenida Presidente Bernardino Rivadavia 15000, Piso 3 Oficina B, Ciudad Autónoma de Buenos Aires"

const empresa = (nombreEmpresa: string) => ({
  nombreEmpresa,
  telefonoEmpresa: "+54 11 4000-1234",
  direccionEmpresa: DIRECCION_LARGA,
  moneda: "ARS",
  zonaHoraria: "America/Argentina/Buenos_Aires",
})

const generadores: Record<string, { titulo: string; generar: (nombre: string) => Promise<Buffer> }> = {
  venta: {
    titulo: "VENTA",
    generar: (n) =>
      generateVentaPDF({
        numeroVenta: 42,
        fecha: new Date("2026-01-15"),
        cliente: { nombre: "Laura" },
        vendedor: "Carlos",
        items: [{ descripcion: "FUNDA", cantidad: 1, precioUnitario: 1, subtotal: 1, diasGarantia: 0 }],
        subtotal: 1,
        descuento: 0,
        total: 1,
        metodoPago: "EFECTIVO",
        ...empresa(n),
      } as any),
  },
  garantia: {
    titulo: "GARANTÍA",
    generar: (n) =>
      generateGarantiaVentaPDF({
        numeroGarantia: "GAR-0015",
        venta: { numeroVenta: 42, fecha: new Date("2026-01-15") },
        cliente: { nombre: "Laura" },
        item: { descripcion: "FUNDA", cantidad: 1 },
        diasValidez: 90,
        fechaInicio: new Date("2026-01-15"),
        fechaVencimiento: new Date("2026-04-15"),
        ...empresa(n),
      } as any),
  },
  entrega: {
    titulo: "#0001",
    generar: (n) =>
      generateComprobanteEntregaPDF({
        numeroOrden: 1,
        fechaIngreso: new Date("2026-01-10"),
        fechaEntrega: new Date("2026-01-20"),
        cliente: { nombre: "Juan" },
        dispositivo: "iPhone 13",
        tipoDispositivo: "CELULAR",
        marca: "Apple",
        problemaReportado: "No enciende",
        ...empresa(n),
      } as any),
  },
  cotizacion: {
    titulo: "COTIZACIÓN",
    generar: (n) => generateCotizacionPDF({ ...(buildCotizacionPresupuestoFixture() as any), ...empresa(n) }),
  },
}

let bold: PDFFont
let regular: PDFFont
beforeAll(async () => {
  // Las mismas TTF (Inter) que embebe lib/pdf.ts, para medir igual que él.
  const doc = await PDFDocument.create()
  doc.registerFontkit((fontkitModule as any).default || fontkitModule)
  const fonts = join(process.cwd(), "lib", "fonts")
  bold = await doc.embedFont(readFileSync(join(fonts, "Inter-Bold.ttf")))
  regular = await doc.embedFont(readFileSync(join(fonts, "Inter-Regular.ttf")))
})

describe("encabezado con nombre de empresa largo", () => {
  for (const [doc, { titulo, generar }] of Object.entries(generadores)) {
    it(`${doc}: el nombre y los datos no pisan el bloque del documento`, async () => {
      const items = (await extractPdfTextPositions(await generar(NOMBRE_LARGO))).filter((i) => i.page === 0)
      const tituloItem = items.find((i) => i.text === titulo)
      expect(tituloItem).toBeDefined()

      const nombre = items.find((i) => i.text.startsWith("Servicio Técnico Integral"))
      expect(nombre).toBeDefined()
      expect(nombre!.text).not.toBe(NOMBRE_LARGO)
      expect(nombre!.text.endsWith("…")).toBe(true)
      expect(nombre!.size).toBeGreaterThanOrEqual(11)

      // Todo el bloque de la empresa termina antes del bloque de la derecha,
      // cuyo borde izquierdo es el del más ancho de sus renglones.
      const bordeDerecho = Math.min(
        ...items.filter((i) => i.y > nombre!.y - 40 && i.x > 300).map((i) => i.x),
      )
      const empresaItems = items.filter(
        (i) => i.x === nombre!.x && (i.text.startsWith("Servicio") || i.text.startsWith("Tel:") || i.text.startsWith("Avenida")),
      )
      for (const i of empresaItems) {
        const font = i.text.startsWith("Servicio") ? bold : regular
        expect(i.x + font.widthOfTextAtSize(i.text, i.size)).toBeLessThan(bordeDerecho)
      }
    })

    it(`${doc}: un nombre corto sale completo a 16pt`, async () => {
      const items = await extractPdfTextPositions(await generar("Servicio Técnico Demo"))
      const nombre = items.find((i) => i.text === "Servicio Técnico Demo")
      expect(nombre).toBeDefined()
      expect(nombre!.size).toBe(16)
    })
  }
})
