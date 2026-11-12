// @vitest-environment node
import { describe, it, expect } from "vitest"
import { PDFDocument, StandardFonts } from "pdf-lib"
import { dibujarEstadoFisico, lineasEstadoFisico, type EstadoFisicoPDF } from "@/lib/pdf-estado-fisico"

const base: EstadoFisicoPDF = {
  diagrama: "celular@1",
  sinDanos: false,
  danos: [
    { numero: 1, vista: "frente", x: 0.3, y: 0.4, tipo: "golpe", nota: "pantalla", momento: "recepcion" },
    { numero: 2, vista: "dorso", x: 0.5, y: 0.5, tipo: "rayon", nota: null, momento: "recepcion" },
    { numero: 3, vista: "frente", x: 0.7, y: 0.2, tipo: "rotura", nota: "marco", momento: "diagnostico" },
  ],
}

async function dibujar(e: EstadoFisicoPDF) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  return dibujarEstadoFisico(page, e, { x: 28, y: 800, w: 539 }, { regular, bold })
}

describe("lineasEstadoFisico", () => {
  it("lista solo los pins del momento pedido con el formato exacto", () => {
    expect(lineasEstadoFisico(base, "recepcion")).toEqual(["1. Golpe (frente) – pantalla", "2. Rayón (dorso)"])
    expect(lineasEstadoFisico(base, "diagnostico")).toEqual(["3. Rotura (frente) – marco"])
  })
  it("con sin daños devuelve una sola línea", () => {
    expect(lineasEstadoFisico({ diagrama: "celular@1", sinDanos: true, danos: [] }, "recepcion")).toEqual([
      "Sin daños visibles al ingreso",
    ])
  })
})

describe("dibujarEstadoFisico", () => {
  it("dibuja vistas, pins y bloque de diagnóstico con altura acotada", async () => {
    const h = await dibujar(base)
    expect(h).toBeGreaterThan(0)
    expect(h).toBeLessThan(400)
  })
  it("no tira con una nota de 200 caracteres sin espacios y emojis", async () => {
    const e: EstadoFisicoPDF = {
      ...base,
      danos: [{ ...base.danos[0], nota: "😀".repeat(20) + "x".repeat(180) }],
    }
    const h = await dibujar(e)
    expect(h).toBeGreaterThan(0)
    expect(h).toBeLessThan(400)
  })
  it("un diagrama desconocido usa el genérico", async () => {
    const h = await dibujar({ ...base, diagrama: "xx@9" })
    expect(h).toBeGreaterThan(0)
  })
  it("sin daños dibuja una línea corta", async () => {
    const h = await dibujar({ diagrama: "celular@1", sinDanos: true, danos: [] })
    expect(h).toBeGreaterThan(0)
    expect(h).toBeLessThan(40)
  })
})

describe("generateOrdenPDF con estadoFisico", () => {
  const imprimir = async (extra: Record<string, unknown>) => {
    const { generateOrdenPDF } = await import("@/lib/pdf")
    const { buildOrdenFixture } = await import("./orden-fixture")
    const { extractPdfText } = await import("./pdf-text-helper")
    const buf = await generateOrdenPDF({ ...buildOrdenFixture(), ...extra } as never)
    return { paginas: (await PDFDocument.load(buf)).getPageCount(), texto: await extractPdfText(buf) }
  }
  const ENTREGA = { estado: "ENTREGADO", fechaEntrega: new Date(), fechaCompletado: new Date() }

  it("sin estadoFisico no dibuja el bloque", async () => {
    const r = await imprimir({})
    expect(r.paginas).toBe(1)
    expect(r.texto).not.toContain("Estado físico al ingreso")
  })
  it("recepción: dibuja el bloque con la lista y el de diagnóstico", async () => {
    const r = await imprimir({ estadoFisico: base })
    expect(r.paginas).toBe(1)
    expect(r.texto).toContain("Estado físico al ingreso")
    expect(r.texto).toContain("Golpe (frente)")
    expect(r.texto).toContain("Detectados en diagnóstico")
  })
  it("sin daños: una línea", async () => {
    const r = await imprimir({ estadoFisico: { diagrama: "celular@1", sinDanos: true, danos: [] } })
    expect(r.texto).toContain("Sin daños visibles al ingreso")
  })
  it("recepción sin lugar ni en compacto: el bloque va en una segunda página", async () => {
    const muchos = {
      ...base,
      danos: Array.from({ length: 24 }, (_, i) => ({
        numero: i + 1,
        vista: "frente" as const,
        x: 0.5,
        y: 0.5,
        tipo: "rayon" as const,
        nota: "nota larga ".repeat(12),
        momento: "recepcion" as const,
      })),
    }
    const r = await imprimir({ estadoFisico: muchos })
    expect(r.paginas).toBe(2)
    expect(r.texto).toContain("Estado físico al ingreso")
  })
  it("entrega: el bloque va en una segunda página", async () => {
    const r = await imprimir({ ...ENTREGA, estadoFisico: base })
    expect(r.paginas).toBe(2)
    expect(r.texto).toContain("Estado físico al ingreso")
  })
})
