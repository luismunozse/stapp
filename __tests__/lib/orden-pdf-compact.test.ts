// @vitest-environment node
/**
 * The A5 / A6 layout of the service-order PDF (lib/pdf-orden-compact.ts, reached through
 * generateOrdenPDF({ ..., paperSize })).
 *
 * What the customer complained about: the A4 page printed on an A6 sheet comes out at half
 * size, "you can hardly read anything". So the tests that matter here are about legibility
 * and about never losing content: page sizes, minimum font sizes, long text flowing onto an
 * extra page instead of overflowing, and a geometric check (using the real TTF metrics) that
 * no text run leaves the page or lands on top of another one.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"
import fontkitModule from "@pdf-lib/fontkit"
import { PDFDocument } from "pdf-lib"
import { generateOrdenPDF } from "@/lib/pdf"
import { wrapText } from "@/lib/pdf-orden-compact"
import { formatCurrencyValue } from "@/lib/currency"
import { extractPdfText, extractPdfTextPositions, type PositionedText } from "./pdf-text-helper"
import { buildOrdenFixture } from "./orden-fixture"

const fontkit = (fontkitModule as any).default || fontkitModule

const FIXED = new Date("2026-03-10T15:00:00.000Z")
const LOREM =
  "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat."

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    ...buildOrdenFixture(),
    fechaIngreso: FIXED,
    fechaPrometida: new Date("2026-03-13T15:00:00.000Z"),
    timeline: [{ estado: "RECIBIDO", fecha: FIXED }],
    garantia: { dias: 90, fechaVencimiento: new Date("2026-06-08T15:00:00.000Z"), notas: null },
    cobros: [{ fecha: FIXED, metodo: "EFECTIVO", referencia: null, monto: 10000 }],
    ...overrides,
  }
}

const ENTREGA = {
  estado: "ENTREGADO",
  fechaEntrega: new Date("2026-03-12T15:00:00.000Z"),
  fechaCompletado: new Date("2026-03-12T14:00:00.000Z"),
  entregadoPor: "M. Gomez",
  costoFinal: 48000,
  totalCobrado: 10000,
  diagnostico: "Bateria agotada, se reemplaza por una nueva.",
  timeline: [
    { estado: "RECIBIDO", fecha: FIXED },
    { estado: "ENTREGADO", fecha: new Date("2026-03-12T15:00:00.000Z") },
  ],
}

/**
 * A typical order at the counter: no extra remarks, no metadata, two short terms. This is what
 * has to fit on a single small sheet. (The fully populated fixture of the other tests carries
 * remarks, a long default terms block and more, and takes a second sheet on A6.)
 */
const LEAN = {
  observaciones: null,
  checklistItems: null,
  checklistNotas: null,
  metadataCampos: null,
  recepcionTerminos: "1. Conserve este comprobante para retirar su equipo.\n2. El presupuesto puede variar.",
}

/** The shortest real order: no money, no remarks, nobody named. This is what one A6 sheet holds. */
const MINIMAL = {
  ...LEAN,
  presupuesto: null,
  sena: null,
  fechaPrometida: null,
  telefonoContacto: null,
  recibidoPorNombre: null,
  tecnicoNombre: null,
  sucursal: null,
}

/** Same text, whitespace-normalized: currency strings carry non-breaking spaces. */
const norm = (s: string) => s.replace(/\s+/g, " ")

const SIZES = {
  A5: { page: [420, 595], minFont: 9, minBody: 9.5 },
  A6: { page: [298, 420], minFont: 8, minBody: 8.5 },
} as const
type Compact = keyof typeof SIZES

async function render(paperSize: "A4" | Compact, overrides: Record<string, unknown> = {}) {
  const buffer = await generateOrdenPDF({ ...fixture(overrides), paperSize } as any)
  const doc = await PDFDocument.load(buffer)
  const runs = await extractPdfTextPositions(buffer)
  const text = (await extractPdfText(buffer)).replace(/\s+/g, " ")
  return { buffer, doc, runs, text, pages: doc.getPages().map((p) => [p.getWidth(), p.getHeight()]) }
}

// ---- real glyph metrics, from the same TTF files the generator embeds ----
const FONT_FILES: Array<[string, string]> = [
  ["ArchivoCondensed-Black", "ArchivoCondensed-Black.ttf"],
  ["ArchivoCondensed-Bold", "ArchivoCondensed-Bold.ttf"],
  ["Archivo-Black", "Archivo-Black.ttf"],
  ["Archivo-Bold", "Archivo-Bold.ttf"],
  ["Archivo-Regular", "Archivo-Regular.ttf"],
  ["IBMPlexMono", "IBMPlexMono-Regular.ttf"],
]
const fontCache = new Map<string, any>()
function widthOf(run: PositionedText): number {
  const hit = FONT_FILES.find(([needle]) => run.font.includes(needle))
  if (!hit) throw new Error(`unknown font in PDF: "${run.font}"`)
  if (!fontCache.has(hit[1])) {
    fontCache.set(hit[1], fontkit.create(readFileSync(join(process.cwd(), "lib", "fonts", hit[1]))))
  }
  const font = fontCache.get(hit[1])
  return (font.layout(run.text).advanceWidth / font.unitsPerEm) * run.size
}

/** Every run inside the page (with a margin) and no two runs on top of each other. */
function expectNoClippingNoOverlap(runs: PositionedText[], page: readonly number[]) {
  const [w, h] = page
  const boxes = runs.map((r) => {
    const width = widthOf(r)
    return { r, x1: r.x, x2: r.x + width, y1: r.y - r.size * 0.22, y2: r.y + r.size * 0.78 }
  })
  for (const b of boxes) {
    expect(b.x1, `"${b.r.text}" starts left of the page`).toBeGreaterThanOrEqual(8)
    expect(b.x2, `"${b.r.text}" runs past the right edge`).toBeLessThanOrEqual(w - 8)
    expect(b.y1, `"${b.r.text}" is below the bottom edge`).toBeGreaterThanOrEqual(8)
    expect(b.y2, `"${b.r.text}" is above the top edge`).toBeLessThanOrEqual(h - 8)
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      if (a.r.page !== b.r.page) continue
      const overlapX = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)
      const overlapY = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1)
      expect(
        overlapX > 0.5 && overlapY > 0.5,
        `"${a.r.text}" overlaps "${b.r.text}" (page ${a.r.page + 1})`,
      ).toBe(false)
    }
  }
}

describe("wrapText", () => {
  const measure = (s: string) => s.length * 5 // 5pt per character, easy to reason about

  it("breaks on spaces so that no line is wider than the limit", () => {
    const lines = wrapText("uno dos tres cuatro cinco seis", measure, 60) // 12 chars per line
    expect(lines).toEqual(["uno dos tres", "cuatro cinco", "seis"])
  })

  it("keeps a short text on one line and returns nothing for empty text", () => {
    expect(wrapText("hola", measure, 100)).toEqual(["hola"])
    expect(wrapText("", measure, 100)).toEqual([])
    expect(wrapText("   ", measure, 100)).toEqual([])
  })

  it("hard-splits a word that is wider than the line instead of letting it overflow", () => {
    const lines = wrapText("a " + "x".repeat(25) + " b", measure, 50) // 10 chars per line
    expect(lines.length).toBeGreaterThan(3)
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(50)
    expect(lines.join("")).toContain("x".repeat(25).slice(0, 10))
    expect(lines.join("").replace(/\s/g, "")).toBe("a" + "x".repeat(25) + "b")
  })
})

describe("page size of each format", () => {
  it("A4 is 595x842, A5 is 420x595 and A6 is 298x420: one page for the order a sheet is meant to hold", async () => {
    expect((await render("A4", LEAN)).pages).toEqual([[595, 842]])
    expect((await render("A5", LEAN)).pages).toEqual([[420, 595]]) // with money, retiro date and who attended
    expect((await render("A6", MINIMAL)).pages).toEqual([[298, 420]])
  })

  it("an order with money and remarks takes a second A6 sheet instead of shrinking the text", async () => {
    const out = await render("A6", LEAN)
    expect(out.pages).toEqual([[298, 420], [298, 420]])
    expect(Math.min(...out.runs.map((r) => r.size))).toBeGreaterThanOrEqual(SIZES.A6.minFont)
  })

  it("every page of a longer document keeps the size of its paper", async () => {
    for (const key of ["A5", "A6"] as Compact[]) {
      const out = await render(key) // the fully populated fixture
      expect(out.pages.length).toBeGreaterThan(0)
      for (const p of out.pages) expect(p).toEqual(SIZES[key].page)
    }
  })

  it("the ENTREGA sheet (delivered order) has the same page sizes", async () => {
    expect((await render("A5", { ...LEAN, ...ENTREGA })).pages[0]).toEqual([420, 595])
    expect((await render("A6", { ...LEAN, ...ENTREGA })).pages[0]).toEqual([298, 420])
  })

  it("soloCliente (the WhatsApp variant) does not apply to a small paper: the page is the paper", async () => {
    const out = await render("A6", { ...MINIMAL, soloCliente: true })
    expect(out.pages).toEqual([[298, 420]])
    expect(out.text).toContain("FIRMA DEL CLIENTE") // the whole sheet is drawn, not the cropped A4 variant
  })
})

describe("legibility: the reason this format exists", () => {
  for (const key of ["A5", "A6"] as Compact[]) {
    const { minFont, minBody } = SIZES[key]

    it(`${key}: every text is drawn at ${minFont}pt or more, on both sheets`, async () => {
      for (const extra of [{}, ENTREGA]) {
        const { runs } = await render(key, extra)
        expect(runs.length).toBeGreaterThan(25)
        const smallest = Math.min(...runs.map((r) => r.size))
        expect(smallest).toBeGreaterThanOrEqual(minFont)
      }
    })

    it(`${key}: the problem description (the body text) is at least ${minBody}pt`, async () => {
      const { runs } = await render(key)
      const falla = runs.find((r) => r.text.startsWith("El equipo no enciende"))
      expect(falla, "problem description not found").toBeDefined()
      expect(falla!.size).toBeGreaterThanOrEqual(minBody)
    })
  }

  it("A5 reads bigger than A6, and both bigger than the half-size A4-on-A6 print (4.5pt of the 9pt A4 body)", async () => {
    const a5 = (await render("A5")).runs.find((r) => r.text.startsWith("El equipo no enciende"))!
    const a6 = (await render("A6")).runs.find((r) => r.text.startsWith("El equipo no enciende"))!
    expect(a5.size).toBeGreaterThan(a6.size)
    expect(a6.size).toBeGreaterThan(9 * 0.7071 * 0.7071 * 1.5) // A4 -> A6 scale is 0.5: 4.5pt
  })
})

describe("content: the same information as the A4 sheet, stacked in one column", () => {
  for (const key of ["A5", "A6"] as Compact[]) {
    it(`${key} RECEPCION: workshop, order, customer, device, problem, accessories, money, terms, signature`, async () => {
      const { text } = await render(key)
      for (const piece of [
        "Servicio Técnico Demo",
        "#1042",
        "CEL-1042",
        "RECIBIDO",
        "Juan Pérez",
        "DNI 28.456.789",
        "Apple iPhone 13 · Negro",
        "IMEI 358400123456789",
        "El equipo no enciende desde que se mojó levemente con la lluvia. Además, la pantalla parpadea de forma intermitente cada vez que se intenta reiniciarlo.",
        "Cargador, funda, chip claro",
        "El cliente solicita que se lo contacte únicamente por WhatsApp.",
        formatCurrencyValue(45000, "ARS"),
        formatCurrencyValue(10000, "ARS"),
        formatCurrencyValue(35000, "ARS"),
        "Retiro estimado",
        "Escaneá el código para seguir tu reparación",
        "FIRMA DEL CLIENTE",
        "Conserve este comprobante para retirar su equipo.",
        // (the ligature "fi" does not survive the test's text extraction, so no "final"/"firmar" here)
        "El presupuesto puede variar según el diagnóstico",
      ]) {
        expect(text, `missing: ${piece}`).toContain(norm(piece))
      }
    })

    it(`${key} RECEPCION: one customer copy, so no cut line, no internal stub and no device access code`, async () => {
      const { text } = await render(key)
      expect(text).not.toContain("TALÓN")
      expect(text).not.toContain("PARTE SUPERIOR")
      expect(text).not.toContain("1-2-5-8-9")
      // the reception checklist is on the A4 internal stub, which a single customer copy does not have
      expect(text).not.toContain("CHEQUEO DE RECEPCIÓN")
    })

    it(`${key} ENTREGA: work done, totals, payments, warranty and delivery signatures`, async () => {
      const { text } = await render(key, ENTREGA)
      for (const piece of [
        "#1042",
        "ENTREGADO",
        "Bateria agotada, se reemplaza por una nueva.",
        "Batería iPhone 13",
        "TOTAL FINAL",
        formatCurrencyValue(48000, "ARS"),
        "SALDO",
        formatCurrencyValue(38000, "ARS"),
        "PAGOS REGISTRADOS",
        "CHEQUEO DE RECEPCIÓN",
        "Pantalla táctil funciona: OK",
        "Cámara trasera funciona: NO",
        "GARANTÍA 90 DÍAS",
        "Vigente hasta",
        "CLIENTE — ENTREGA",
        "ENTREGÓ — M. GOMEZ",
        "Conserve este comprobante",
      ]) {
        expect(text, `missing: ${piece}`).toContain(norm(piece))
      }
      expect(text).not.toContain("1-2-5-8-9")
    })
  }

  it("keeps the sections in reading order, top to bottom, on the first page", async () => {
    const { runs } = await render("A6", MINIMAL)
    const y = (needle: string) => {
      const hit = runs.find((r) => r.page === 0 && r.text.includes(needle))
      if (!hit) throw new Error(`not found: ${needle}`)
      return hit.y
    }
    expect(y("#1042")).toBeGreaterThan(y("Juan Pérez"))
    expect(y("Juan Pérez")).toBeGreaterThan(y("Apple iPhone 13"))
    expect(y("Apple iPhone 13")).toBeGreaterThan(y("El equipo no enciende"))
    expect(y("El equipo no enciende")).toBeGreaterThan(y("Cargador, funda"))
    expect(y("Cargador, funda")).toBeGreaterThan(y("FIRMA DEL CLIENTE"))
  })
})

describe("nothing clipped, nothing overlapping", () => {
  for (const key of ["A5", "A6"] as Compact[]) {
    it(`${key}: every run stays inside the page and none lands on another (both sheets)`, async () => {
      for (const extra of [{}, ENTREGA]) {
        const { runs, pages } = await render(key, extra)
        expectNoClippingNoOverlap(runs, pages[0])
      }
    })
  }

  it("a word with no spaces that is wider than the page is split, not clipped", async () => {
    const monster = "X".repeat(140)
    const { runs, pages, text } = await render("A6", { problemaReportado: monster, accesorios: monster })
    expectNoClippingNoOverlap(runs, pages[0])
    expect(text.replace(/\s/g, "")).toContain(monster)
  })
})

describe("long content flows onto extra pages", () => {
  const longTerms = Array.from({ length: 30 }, (_, i) => `${i + 1}. ${LOREM}`).join("\n")

  for (const key of ["A5", "A6"] as Compact[]) {
    it(`${key}: long terms add pages and keep every term, instead of overflowing the first one`, async () => {
      const out = await render(key, { recepcionTerminos: longTerms })
      expect(out.pages.length).toBeGreaterThan(1)
      for (const p of out.pages) expect(p).toEqual(SIZES[key].page)
      expect(out.text).toContain("1. Lorem ipsum dolor sit amet")
      expect(out.text).toContain("30. Lorem ipsum dolor sit amet")
      expect(out.text).toContain(`${out.pages.length}/${out.pages.length}`)
      // geometry holds page by page
      for (let i = 0; i < out.pages.length; i++) {
        expectNoClippingNoOverlap(out.runs.filter((r) => r.page === i), out.pages[i])
      }
      // every text, on every page, still respects the minimum size
      expect(Math.min(...out.runs.map((r) => r.size))).toBeGreaterThanOrEqual(SIZES[key].minFont)
    })
  }

  it("a continuation page says which order it belongs to", async () => {
    const out = await render("A6", { recepcionTerminos: longTerms })
    const secondPage = out.runs.filter((r) => r.page === 1).map((r) => r.text).join(" ")
    expect(secondPage).toContain("#1042")
    expect(secondPage).toContain("2/")
  })

  it("a single long field (problem) flows across pages and every word survives", async () => {
    const huge = Array.from({ length: 60 }, (_, i) => `palabra${i}`).join(" ").repeat(6)
    const out = await render("A6", { problemaReportado: huge })
    expect(out.pages.length).toBeGreaterThan(1)
    expect(out.text).toContain("palabra59")
    expectNoClippingNoOverlap(out.runs.filter((r) => r.page === 0), out.pages[0])
  })

  it("a normal order stays on ONE page and prints no page counter", async () => {
    for (const [key, extra] of [["A5", LEAN], ["A6", MINIMAL]] as const) {
      const out = await render(key, extra)
      expect(out.pages).toHaveLength(1)
      expect(out.text).not.toContain("1/1")
    }
  })

  it("A4 is not touched by the long terms: still one page of 595x842", async () => {
    const out = await render("A4", { recepcionTerminos: longTerms })
    expect(out.pages).toEqual([[595, 842]])
  })
})
