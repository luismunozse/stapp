// @vitest-environment node
/**
 * Informe técnico de la orden: fluye en varias páginas, trae el diagnóstico
 * completo (sin cortes), los avances, el trabajo con total y las fotos.
 */
import { describe, it, expect } from "vitest"
import sharp from "sharp"
import { PDFDocument, PDFName, PDFDict } from "pdf-lib"
import { generateInformeTecnicoPDF, type InformeTecnicoPDFData } from "@/lib/informe-tecnico-react-pdf"
import { aJpegInforme } from "@/lib/ordenes/informe-fotos"
import { extractReactPdfText } from "./pdf-text-helper-react"

async function imagen(formato: "png" | "webp", w = 1600, h = 1200, r = 200): Promise<Buffer> {
  const img = sharp({ create: { width: w, height: h, channels: 3, background: { r, g: 40, b: 40 } } })
  return formato === "png" ? img.png().toBuffer() : img.webp().toBuffer()
}

async function base(overrides: Partial<InformeTecnicoPDFData> = {}): Promise<InformeTecnicoPDFData> {
  return {
    nombreEmpresa: "Taller Demo",
    moneda: "ARS",
    zonaHoraria: "America/Argentina/Buenos_Aires",
    cliente: { nombre: "Ana Pérez", telefono: "3415551234" },
    codigoOrden: "CEL0042",
    fechaIngreso: new Date("2026-11-01T15:00:00Z"),
    fechaEntrega: new Date("2026-11-08T15:00:00Z"),
    estado: "Entregado",
    equipo: { tipo: "Celular", marca: "Samsung", modelo: "A52", identificadorLabel: "IMEI", identificador: "358400123456789" },
    falla: "No carga",
    diagnostico: "Conector de carga sulfatado.",
    tecnicoNombre: "L. Ferreyra",
    avances: [
      { fecha: new Date("2026-11-03T15:00:00Z"), texto: "Se desarmó el equipo" },
      { fecha: new Date("2026-11-05T15:00:00Z"), texto: "Se reemplazó el conector de carga" },
    ],
    trabajos: [
      { nombre: "Conector de carga", cantidad: 1, importe: 12000 },
      { nombre: "Repuesto viejo sin precio", cantidad: 1, importe: 0 },
    ],
    costoFinal: 20000,
    garantia: { dias: 90, fechaVencimiento: new Date("2027-02-06T15:00:00Z") },
    fotos: [],
    ...overrides,
  }
}

const imagenesEnPdf = async (buffer: Buffer) => {
  const doc = await PDFDocument.load(buffer)
  let n = 0
  for (const page of doc.getPages()) {
    const xobjects = page.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict)
    n += xobjects ? xobjects.keys().length : 0
  }
  return { n, paginas: doc.getPageCount() }
}

describe("generateInformeTecnicoPDF", () => {
  it("trae equipo, falla, diagnóstico, avances, trabajo con total y garantía", async () => {
    const text = (await extractReactPdfText(await generateInformeTecnicoPDF(await base()))).replace(/\s+/g, " ")
    expect(text).toContain("INFORME TÉCNICO")
    expect(text).toContain("CEL0042")
    expect(text).toContain("Samsung")
    expect(text).toContain("358400123456789")
    expect(text).toContain("Conector de carga sulfatado.")
    expect(text).toContain("Se reemplazó el conector de carga")
    expect(text).toContain("Mano de obra y otros")
    expect(text).toMatch(/TOTAL/)
    expect(text).toContain("Garantía de 90 días")
    // Las líneas sin precio no se listan.
    expect(text).not.toContain("Repuesto viejo sin precio")
  })

  it("un diagnóstico larguísimo sale completo, en las páginas que haga falta", async () => {
    const largo = Array.from({ length: 900 }, (_, i) => `palabra${i}`).join(" ")
    const buffer = await generateInformeTecnicoPDF(await base({ diagnostico: largo }))
    const text = (await extractReactPdfText(buffer)).replace(/\s+/g, " ")
    expect(text).toContain("palabra899")
    expect((await imagenesEnPdf(buffer)).paginas).toBeGreaterThan(1)
  })

  it("dibuja las fotos", async () => {
    const fotos = await Promise.all(
      [1, 2, 3].map(async (i) => ({
        etiqueta: "Al entregar",
        descripcion: `foto ${i}`,
        fecha: new Date(),
        jpeg: await aJpegInforme(await imagen("png", 800, 600, 60 * i)),
      }))
    )
    const buffer = await generateInformeTecnicoPDF(await base({ fotos }))
    expect((await imagenesEnPdf(buffer)).n).toBeGreaterThanOrEqual(3)
    expect((await extractReactPdfText(buffer)).replace(/\s+/g, " ")).toContain("Al entregar")
  })
})

describe("aJpegInforme", () => {
  it("pasa PNG y WebP a JPEG con el lado mayor acotado", async () => {
    for (const formato of ["png", "webp"] as const) {
      const out = await aJpegInforme(await imagen(formato))
      const meta = await sharp(out).metadata()
      expect(meta.format, formato).toBe("jpeg")
      expect(Math.max(meta.width!, meta.height!), formato).toBeLessThanOrEqual(1000)
    }
  })
})
