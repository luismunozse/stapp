// @vitest-environment node
/**
 * The A5 / A6 layout of the service-order PDF (lib/pdf-orden-compact.ts, reached through
 * generateOrdenPDF({ ..., paperSize })).
 *
 * What the customer complained about: the A4 page printed on an A6 sheet comes out at half
 * size, "you can hardly read anything". So the tests that matter here are about legibility
 * and about never losing content: page sizes, minimum font sizes, everything fitted on ONE page
 * instead of overflowing, and a geometric check (using the real TTF metrics) that
 * no text run leaves the page or lands on top of another one.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"
import fontkitModule from "@pdf-lib/fontkit"
import { PDFDocument, PDFDict, PDFName } from "pdf-lib"
import QRCode from "qrcode"
import { generateOrdenPDF } from "@/lib/pdf"
import { wrapText, cutText, clampLines, summarizeChecklist, generateOrdenCompactPDF, type FitReport } from "@/lib/pdf-orden-compact"
import { DEFAULT_RECEPCION_TERMINOS } from "@/lib/terminos"
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

/**
 * Where the fit may shrink the text to: `text` for everything but the terms (the smallest the
 * body can get), `terms` for the terms block, which shrinks first and goes further.
 */
const FLOORS = {
  A5: { text: 7.5, terms: 6.5 },
  A6: { text: 6.5, terms: 5.5 },
} as const

/** Normal (full-size) font sizes of the layout. */
const NORMAL = {
  A5: { body: 10, terms: 9, heading: 15, number: 24 },
  A6: { body: 8.5, terms: 8, heading: 12, number: 19 },
} as const

/** An order that fits its sheet at full size. */
const TYPICAL = { A5: LEAN, A6: MINIMAL } as const

/**
 * Everything but the shop-copy tests at the bottom pins the CUSTOMER sheet, which is what
 * `soloCliente` returns on its own (no second page). A4 ignores the flag here: it would crop the page.
 */
const customerCopy = (paperSize: "A4" | Compact) => (paperSize === "A4" ? {} : { soloCliente: true })

async function render(paperSize: "A4" | Compact, overrides: Record<string, unknown> = {}) {
  const buffer = await generateOrdenPDF({ ...customerCopy(paperSize), ...fixture(overrides), paperSize } as any)
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

describe("cutText", () => {
  it("keeps the beginning and closes with an ellipsis; a text that already fits is returned as it is", () => {
    expect(cutText("abcdefgh", 5)).toBe("abcde…")
    expect(cutText("abcde", 5)).toBe("abcde")
    expect(cutText("abc", 10)).toBe("abc")
  })

  it("does not leave a space before the ellipsis, and never splits a surrogate pair", () => {
    expect(cutText("ab cd", 3)).toBe("ab…")
    expect(cutText("a😀b", 2)).toBe("a…") // 😀 is two UTF-16 units: cutting between them would corrupt the text
    expect(cutText("a😀b", 3)).toBe("a😀…")
  })
})

describe("clampLines", () => {
  const measure = (s: string) => s.length * 5

  it("keeps the first lines and closes the last one with an ellipsis that still fits the width", () => {
    expect(clampLines(["uno dos", "tres cuatro", "cinco"], 2, measure, 60)).toEqual(["uno dos", "tres cuatro…"]) // 12 characters fit in 60
    const out = clampLines(["aaaa bbbb", "cccc dddd eeee", "ffff"], 2, measure, 60) // 12 characters per line
    expect(out).toHaveLength(2)
    expect(out[1].endsWith("…")).toBe(true)
    for (const l of out) expect(measure(l)).toBeLessThanOrEqual(60)
  })

  it("returns the lines untouched when they already fit the limit", () => {
    expect(clampLines(["a", "b"], 2, measure, 60)).toEqual(["a", "b"])
    expect(clampLines(["a"], 5, measure, 60)).toEqual(["a"])
  })

  it("never returns fewer than one line", () => {
    const out = clampLines(["alpha beta", "gamma"], 0, measure, 100)
    expect(out).toHaveLength(1)
    expect(out[0].endsWith("…")).toBe(true)
  })
})

/** Number of images (XObjects) drawn on the first page. */
function imageCount(doc: PDFDocument): number {
  const xobjects = doc.getPage(0).node.Resources()?.lookup(PDFName.of("XObject"), PDFDict)
  return xobjects ? xobjects.entries().length : 0
}

describe("device access code and logo", () => {
  for (const key of ["A5", "A6"] as Compact[]) {
    it(`${key}: neither a pattern nor a PIN is printed, on either sheet`, async () => {
      for (const extra of [{}, ENTREGA]) {
        for (const code of ["Patrón: 1-2-5-8-9", "4821"]) {
          const { text } = await render(key, { ...extra, codigoAccesoDispositivo: code })
          expect(text).not.toContain("1-2-5-8-9")
          expect(text).not.toContain("4821")
        }
      }
    })

    it(`${key}: the workshop logo is embedded when there is one and nothing is drawn when there is none`, async () => {
      const logoUrl = await QRCode.toDataURL("logo", { width: 80, margin: 1 }) // a real PNG, served as a data: URL
      const without = await render(key, MINIMAL)
      const withLogo = await render(key, { ...MINIMAL, logoUrl })
      expect(imageCount(withLogo.doc)).toBe(imageCount(without.doc) + 1)
      // an unreachable logo is skipped without breaking the page
      const broken = await render(key, { ...MINIMAL, logoUrl: "data:image/png;base64,AAAA" })
      expect(imageCount(broken.doc)).toBe(imageCount(without.doc))
      expect(broken.pages).toEqual([SIZES[key].page])
    })
  }
})

describe("wrapText cost", () => {
  it("measures a long unbroken token in near-linear total work, not cubic", () => {
    // Real measuring (fontkit layout) costs time proportional to the length of the string it is
    // given, so what has to stay small is the total number of characters handed to `measure`.
    let work = 0
    const measure = (s: string) => {
      work += s.length
      return s.length * 5
    }
    const token = "x".repeat(3000)
    const lines = wrapText(token, measure, 250) // 50 chars per line
    expect(lines).toHaveLength(60)
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(50)
    expect(lines.join("")).toBe(token)
    expect(work).toBeLessThan(2_000_000) // the old walk-down spent ~270 million
  })

  it("a single glyph wider than the line still advances one character at a time", () => {
    const lines = wrapText("abc", (s) => s.length * 100, 50)
    expect(lines).toEqual(["a", "b", "c"])
  })
})

describe("a 3000-character unbroken token", () => {
  it("generates on A6 in under 2 seconds, on ONE page, with every run inside it", async () => {
    const monster = "Q".repeat(3000)
    const started = Date.now()
    const out = await render("A6", { ...MINIMAL, problemaReportado: monster })
    expect(Date.now() - started).toBeLessThan(2000)
    expect(out.pages).toEqual([[298, 420]]) // the token cannot fit: it is cut, it does not flow onto a second page
    const qs = out.runs.filter((r) => /^Q+…?$/.test(r.text))
    expect(qs.length).toBeGreaterThan(3)
    expect(qs.reduce((n, r) => n + r.text.replace("…", "").length, 0)).toBeLessThan(3000)
    expect(qs[qs.length - 1].text.endsWith("…")).toBe(true)
    expectNoClippingNoOverlap(out.runs, out.pages[0])
  }, 20000)

  it("a very long workshop name (a protected field) does not stall the layout and still gives ONE page", async () => {
    const started = Date.now()
    const out = await render("A6", { nombreEmpresa: "N".repeat(1500), recepcionTerminos: Array.from({ length: 30 }, (_, i) => `${i + 1}. ${LOREM}`).join("\n") })
    expect(Date.now() - started).toBeLessThan(2000)
    expect(out.pages).toEqual([[298, 420]])
    expectNoClippingNoOverlap(out.runs, out.pages[0])
  }, 20000)
})

describe("page size of each format", () => {
  it("A4 is 595x842, A5 is 420x595 and A6 is 298x420: one page for the order a sheet is meant to hold", async () => {
    expect((await render("A4", LEAN)).pages).toEqual([[595, 842]])
    expect((await render("A5", LEAN)).pages).toEqual([[420, 595]]) // with money, retiro date and who attended
    expect((await render("A6", MINIMAL)).pages).toEqual([[298, 420]])
  })

  it("an order with money and remarks that does not fit at full size is squeezed onto ONE A6 sheet", async () => {
    const out = await render("A6", LEAN)
    expect(out.pages).toEqual([[298, 420]])
    expect(out.text).toContain("FIRMA DEL CLIENTE")
    expect(Math.min(...out.runs.map((r) => r.size))).toBeGreaterThanOrEqual(FLOORS.A6.terms - 0.01)
  })

  it("the fully populated order is one page with the size of its paper", async () => {
    for (const key of ["A5", "A6"] as Compact[]) {
      const out = await render(key)
      expect(out.pages).toEqual([SIZES[key].page])
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

    it(`${key}: an order that fits is drawn at ${minFont}pt or more`, async () => {
      const { runs } = await render(key, TYPICAL[key])
      expect(runs.length).toBeGreaterThan(20)
      const smallest = Math.min(...runs.map((r) => r.size))
      expect(smallest).toBeGreaterThanOrEqual(minFont)
    })

    it(`${key}: the problem description (the body text) is at least ${minBody}pt`, async () => {
      const { runs } = await render(key, TYPICAL[key])
      const falla = runs.find((r) => r.text.startsWith("El equipo no enciende"))
      expect(falla, "problem description not found").toBeDefined()
      expect(falla!.size).toBeGreaterThanOrEqual(minBody)
    })
  }

  it("A5 reads bigger than A6, and both bigger than the half-size A4-on-A6 print (4.5pt of the 9pt A4 body)", async () => {
    const a5 = (await render("A5", TYPICAL.A5)).runs.find((r) => r.text.startsWith("El equipo no enciende"))!
    const a6 = (await render("A6", TYPICAL.A6)).runs.find((r) => r.text.startsWith("El equipo no enciende"))!
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
        "GARANTÍA 90 DÍAS",
        "Vigente hasta",
        "CLIENTE — ENTREGA",
        "ENTREGÓ — M. GOMEZ",
        // A5 keeps the checklist and the terms whole. On A6 they do not fit whole: the terms body
        // goes (a line says where to get it) and the checklist becomes one summary line (see the
        // checklist and terms tests).
        ...(key === "A5"
          ? ["CHEQUEO DE RECEPCIÓN", "Pantalla táctil funciona: OK", "Cámara trasera funciona: NO", "Conserve este comprobante"]
          : ["Checklist de ingreso", "Términos completos: pedíselos al taller."]),
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


// ============================================================
// ALWAYS ONE PAGE
// ============================================================
// The owner printed an A6 order that came out on two sheets: "tiene que entrar todo en una sola
// pagina". The sheet is fitted in steps, stopping at the first that works: full size, tighter
// spacing, smaller terms, everything scaled down together, and only then cutting the longest
// free text with an ellipsis. The workshop, the order number, the customer, the device, the
// money, the QR and the signatures are never cut.

const loremTerms = (n: number) => Array.from({ length: n }, (_, i) => `${i + 1}. ${LOREM}`).join("\n")
/** `n` characters of readable, breakable text. */
const prose = (n: number) => LOREM.repeat(Math.ceil(n / LOREM.length)).slice(0, n)
const trabajos = (n: number) => Array.from({ length: n }, (_, i) => ({ nombre: `Reparación de módulo número ${i + 1}`, cantidad: 1, importe: 1000 + i }))
const cobros = (n: number) => Array.from({ length: n }, () => ({ fecha: FIXED, metodo: "EFECTIVO", referencia: null, monto: 1000 }))

type Sheet = "RECEPCION" | "ENTREGA"
const SHEETS: Sheet[] = ["RECEPCION", "ENTREGA"]
const sheetExtra = (sheet: Sheet) => (sheet === "ENTREGA" ? ENTREGA : {})

/** The six inputs that used to overflow a small sheet. */
const OVERFLOW_CASES: Record<string, (key: Compact) => Record<string, unknown>> = {
  "typical order": (key) => TYPICAL[key],
  "30 long terms": () => ({ ...LEAN, recepcionTerminos: loremTerms(30) }),
  "long falla and long observaciones": () => ({
    ...LEAN,
    problemaReportado: prose(2000),
    observaciones: prose(2000),
    diagnostico: prose(2000),
  }),
  "many budget lines": () => ({ ...LEAN, trabajos: trabajos(14), cobros: cobros(6) }),
  "a long unbroken token": () => ({ ...LEAN, problemaReportado: "Q".repeat(3000), diagnostico: "Z".repeat(3000) }),
  "everything at once": () => ({
    problemaReportado: prose(2000),
    observaciones: prose(2000),
    diagnostico: prose(2000),
    accesorios: prose(600),
    recepcionTerminos: loremTerms(30),
    trabajos: trabajos(14),
    cobros: cobros(6),
    checklistNotas: prose(400),
    notasEntrega: prose(400),
  }),
}

/** What must survive any amount of squeezing. */
function expectProtectedContent(text: string, sheet: Sheet, out: { doc: PDFDocument }) {
  for (const piece of ["Servicio Técnico Demo", "#1042", "Ingreso", "Juan Pérez", "+54 9 11 2345-6789", "Apple iPhone 13 · Negro"]) {
    expect(text, `missing: ${piece}`).toContain(norm(piece))
  }
  expect(imageCount(out.doc), "the QR is gone").toBeGreaterThanOrEqual(1)
  if (sheet === "RECEPCION") {
    expect(text).toContain("FIRMA DEL CLIENTE")
  } else {
    for (const piece of ["TOTAL FINAL", formatCurrencyValue(48000, "ARS"), "SALDO", formatCurrencyValue(38000, "ARS"), "CLIENTE — ENTREGA", "ENTREGÓ — M. GOMEZ"]) {
      expect(text, `missing: ${piece}`).toContain(norm(piece))
    }
  }
}

describe("always exactly one page", () => {
  for (const key of ["A5", "A6"] as Compact[]) {
    for (const sheet of SHEETS) {
      for (const [name, build] of Object.entries(OVERFLOW_CASES)) {
        it(`${key} ${sheet}: ${name} is ONE page, inside the margins, with the protected content`, async () => {
          const out = await renderFit(key, { ...build(key), ...sheetExtra(sheet) })
          expect(out.pages).toEqual([SIZES[key].page])
          expectNoClippingNoOverlap(out.runs, out.pages[0])
          // smallest text: the terms floor (the terms shrink further than the rest); the guarantee
          // that goes below it is for absurd input and none of these six cases is
          expect(out.report!.step, `reached ${out.report!.step} at scale ${out.report!.scale}`).not.toBe("guarantee")
          expect(Math.min(...out.runs.map((r) => r.size))).toBeGreaterThanOrEqual(FLOORS[key].terms - 0.01)
          expectProtectedContent(out.text, sheet, out)
        }, 20000)
      }
    }
  }

  it("a sheet with 60 budget lines is one page; the lines that do not fit are summed, the totals stay", async () => {
    const out = await render("A6", { ...LEAN, ...ENTREGA, trabajos: trabajos(60), cobros: cobros(20) })
    expect(out.pages).toEqual([[298, 420]])
    expectNoClippingNoOverlap(out.runs, out.pages[0])
    expect(out.text).toContain("TOTAL FINAL")
    expect(out.text).toContain("SALDO")
    expect(out.text).toMatch(/\+\d+ ítems? más/)
  }, 20000)
})

describe("no multi-page chrome: no continuation header and no i/n counter", () => {
  it("a squeezed sheet prints no 1/1 and nothing but the sheet itself", async () => {
    for (const key of ["A5", "A6"] as Compact[]) {
      const out = await render(key, OVERFLOW_CASES["everything at once"](key))
      expect(out.pages).toHaveLength(1)
      expect(out.runs.some((r) => /^\d+\/\d+$/.test(r.text.trim()))).toBe(false)
      // the order number appears once: there is no running header repeating it
      expect(out.runs.filter((r) => r.text.includes("#1042"))).toHaveLength(1)
    }
  })

  it("the signature block sits at the bottom of the page, under everything else", async () => {
    for (const key of ["A5", "A6"] as Compact[]) {
      const { runs, text } = await render(key, TYPICAL[key])
      expect(text).toContain("FIRMA DEL CLIENTE")
      const sig = runs.find((r) => r.text.includes("FIRMA DEL CLIENTE"))!
      const lowest = Math.min(...runs.map((r) => r.y))
      expect(sig.y).toBe(lowest) // nothing is drawn below the signature label
      expect(sig.y).toBeLessThan(SIZES[key].page[1] * 0.12 + 16) // and it is down at the margin
    }
  })
})

/**
 * How many LOREM terms (about 240 characters each) a LEAN order takes before each step is not
 * enough: this many only need the terms to shrink (step c), this many also need the body to
 * (step d), and still nothing is cut.
 */
const TERMS_ONLY_STEP = { A5: 8, A6: 3 } as const
const BODY_SHRINKS = { A5: 14, A6: 6 } as const

describe("the fit stops at the first step that works", () => {
  for (const key of ["A5", "A6"] as Compact[]) {
    const N = NORMAL[key]

    it(`${key}: an order that fits keeps the normal fonts (step a), nothing is cut`, async () => {
      const out = await render(key, TYPICAL[key])
      const falla = out.runs.find((r) => r.text.startsWith("El equipo no enciende"))!
      const terms = out.runs.find((r) => r.text.startsWith("1. Conserve este comprobante"))!
      const order = out.runs.find((r) => r.text === "#1042")!
      expect(falla.size).toBe(N.body)
      expect(terms.size).toBe(N.terms)
      expect(order.size).toBe(N.number)
      expect(out.text).not.toContain("…")
    })

    it(`${key}: long terms are drawn smaller than the body BEFORE the body shrinks`, async () => {
      const out = await render(key, { ...LEAN, recepcionTerminos: loremTerms(TERMS_ONLY_STEP[key]) })
      const falla = out.runs.find((r) => r.text.startsWith("El equipo no enciende"))!
      const term = out.runs.find((r) => r.text.startsWith("1. Lorem"))!
      expect(out.pages).toHaveLength(1)
      expect(term.size).toBeLessThan(N.terms)
      expect(term.size).toBeGreaterThanOrEqual(FLOORS[key].terms - 0.01)
      expect(falla.size).toBe(N.body) // the body kept its normal size
      expect(out.text).not.toContain("…")
    })

    it(`${key}: when the terms alone cannot absorb it, the body shrinks (never below ${FLOORS[key].text}pt) and nothing is cut`, async () => {
      const out = await renderFit(key, { ...LEAN, recepcionTerminos: loremTerms(BODY_SHRINKS[key]) })
      const falla = out.runs.find((r) => r.text.startsWith("El equipo no enciende"))!
      const term = out.runs.find((r) => r.text.startsWith("1. Lorem"))!
      expect(out.pages).toHaveLength(1)
      expect(out.report!.step).toBe("scale")
      expect(falla.size).toBeLessThan(N.body)
      expect(falla.size).toBeGreaterThanOrEqual(FLOORS[key].text - 0.01)
      expect(term.size).toBeCloseTo(FLOORS[key].terms, 1) // the terms are already at their own floor
      expect(out.text).not.toContain("…")
    })

    it(`${key}: fonts never go below the floors, whatever the content`, async () => {
      for (const sheet of SHEETS) {
        const out = await renderFit(key, { ...OVERFLOW_CASES["everything at once"](key), ...sheetExtra(sheet) })
        expect(out.report!.step).not.toBe("guarantee")
        const small = out.runs.filter((r) => r.size < FLOORS[key].text - 0.01)
        for (const r of small) {
          expect(r.text, `"${r.text}" is below the body floor and is not the terms`).toMatch(/Lorem|ipsum|dolor|consequat|…|Términos completos/i)
          expect(r.size).toBeGreaterThanOrEqual(FLOORS[key].terms - 0.01)
        }
        expect(Math.min(...out.runs.map((r) => r.size))).toBeGreaterThanOrEqual(FLOORS[key].terms - 0.01)
      }
    })
  }
})

describe("step b: tighter spacing", () => {
  it("A6: an order that does not fit at normal spacing fits once tightened, every font at its normal size", async () => {
    // LEAN takes two A6 sheets at normal spacing (it did before the fit existed).
    const out = await render("A6", LEAN)
    const falla = out.runs.find((r) => r.text.startsWith("El equipo no enciende"))!
    const terms = out.runs.find((r) => r.text.startsWith("1. Conserve"))!
    expect(out.pages).toHaveLength(1)
    expect(falla.size).toBe(NORMAL.A6.body)
    expect(terms.size).toBe(NORMAL.A6.terms)
    expect(out.text).not.toContain("…")
    // with more terms tightening is not enough and the terms shrink (step c)
    const heavier = await render("A6", { ...LEAN, recepcionTerminos: loremTerms(TERMS_ONLY_STEP.A6) })
    expect(heavier.runs.find((r) => r.text.startsWith("1. Lorem"))!.size).toBeLessThan(NORMAL.A6.terms)
  })
})

describe("truncation is the last resort, in a fixed order", () => {
  it("the terms are cut before observaciones and falla: those stay whole", async () => {
    const falla = prose(300)
    const obs = prose(250)
    const out = await render("A6", { ...LEAN, problemaReportado: falla, observaciones: obs, recepcionTerminos: loremTerms(30) })
    expect(out.pages).toHaveLength(1)
    expect(out.text).toContain(falla)
    expect(out.text).toContain(obs)
    // the terms are what got cut: the first survives, the last does not, and the cut ends with an ellipsis
    expect(out.text).toContain("1. Lorem ipsum dolor sit amet")
    expect(out.text).not.toContain("30. Lorem ipsum")
    const termRuns = out.runs.filter((r) => /Lorem|ipsum|dolor|consequat|…/.test(r.text) && r.size < FLOORS.A6.text)
    expect(termRuns.length).toBeGreaterThan(3)
    expect(termRuns[termRuns.length - 1].text.endsWith("…")).toBe(true)
  })

  it("then observaciones, then falla and diagnostico: every cut field ends with an ellipsis", async () => {
    const out = await render("A6", OVERFLOW_CASES["everything at once"]("A6"))
    expect(out.pages).toHaveLength(1)
    expect(out.runs.filter((r) => r.text.endsWith("…")).length).toBeGreaterThanOrEqual(1)
    // the falla keeps its start and loses its end
    expect(out.text).toContain(LOREM.slice(0, 60))
    expect(out.text).not.toContain(prose(2000).slice(0, 1500)) // the 2000 characters do not all survive
    // an ellipsis only ever closes a run
    for (const r of out.runs) expect(r.text.includes("…") ? r.text.endsWith("…") : true).toBe(true)
  })

  it("an order that fits is never cut: no ellipsis in the typical or the moderately long cases", async () => {
    for (const key of ["A5", "A6"] as Compact[]) {
      expect((await render(key, TYPICAL[key])).text).not.toContain("…")
    }
    expect((await render("A5", { ...LEAN, recepcionTerminos: loremTerms(4) })).text).not.toContain("…")
  })
})

describe("fitting is fast", () => {
  it("'everything at once' on A6 finishes in under 2 seconds, on both sheets", async () => {
    for (const sheet of SHEETS) {
      const started = Date.now()
      const out = await render("A6", { ...OVERFLOW_CASES["everything at once"]("A6"), ...sheetExtra(sheet) })
      expect(Date.now() - started).toBeLessThan(2000)
      expect(out.pages).toHaveLength(1)
    }
  }, 20000)

  it("a 3000-character token in two fields, on A5, stays fast too", async () => {
    const started = Date.now()
    const out = await render("A5", { ...LEAN, problemaReportado: "Q".repeat(3000), observaciones: "W".repeat(3000) })
    expect(Date.now() - started).toBeLessThan(2000)
    expect(out.pages).toHaveLength(1)
  }, 20000)
})

describe("A4 is not touched by any of this", () => {
  it("long terms keep A4 at one page of 595x842", async () => {
    expect((await render("A4", { recepcionTerminos: loremTerms(30) })).pages).toEqual([[595, 842]])
  })
})

// ============================================================
// THE GUARANTEE: the sheet never overflows, whatever the field
// ============================================================
// Review finding: the fit only knew how to cut some fields. A long warranty note, address, name
// of who attended, e-mail, payment reference or reason for no charge was in no stage, so the
// content ran into the signature block (or off the page) and was drawn that way. Now every free
// text is cut, and if that is not enough the layout keeps reducing (below the usual floor, then
// to a maximum number of lines per paragraph) until it fits. It never draws an overflowing page.

/** The hard minimum of the last-resort scale: nothing is ever drawn below this. */
const HARD_MIN = 5

/** Renders through the compact generator directly to read what the fit decided. */
async function renderFit(paper: Compact, overrides: Record<string, unknown> = {}) {
  let report: FitReport | undefined
  const data = { ...customerCopy(paper), ...fixture(overrides), paperSize: paper }
  const buffer = await generateOrdenCompactPDF(data as any, paper, { report: (r) => (report = r) })
  const doc = await PDFDocument.load(buffer)
  const runs = await extractPdfTextPositions(buffer)
  const text = (await extractPdfText(buffer)).replace(/\s+/g, " ")
  return { buffer, doc, runs, text, pages: doc.getPages().map((p) => [p.getWidth(), p.getHeight()]), report }
}

const SHEET_ORDERS: Record<Sheet, Record<string, unknown>> = {
  RECEPCION: { ...LEAN },
  ENTREGA: { ...LEAN, ...ENTREGA, trabajos: trabajos(8), cobros: cobros(3) },
}

/** The fields that were in no cut stage, each 500 characters. */
function everyFieldLong() {
  const base = buildOrdenFixture()
  return {
    garantia: { dias: 90, fechaVencimiento: new Date("2026-06-08T15:00:00.000Z"), notas: prose(500) },
    sucursal: { nombre: "Sucursal Centro", direccion: prose(500), telefono: "+54 11 4000-1234" },
    direccionEmpresa: prose(500),
    recibidoPorNombre: prose(500),
    tecnicoNombre: prose(500),
    entregadoPor: prose(500),
    cliente: { ...base.cliente, email: "juan" + ".perez".repeat(80) + "@example.com" },
    cobros: [1, 2, 3].map(() => ({ fecha: FIXED, metodo: "EFECTIVO", referencia: prose(500), monto: 1000 })),
    motivoSinCobro: prose(500),
    metodoPagoSena: prose(500),
  }
}

/** The core of the sheet, which no amount of squeezing may remove. */
function expectCore(out: Awaited<ReturnType<typeof renderFit>>, sheet: Sheet) {
  for (const piece of ["Servicio Técnico Demo", "#1042", "Juan Pérez", "+54 9 11 2345-6789", "Apple iPhone 13 · Negro"]) {
    expect(out.text, `missing: ${piece}`).toContain(norm(piece))
  }
  expect(imageCount(out.doc), "the QR is gone").toBeGreaterThanOrEqual(1)
  expect(out.text).toContain(sheet === "RECEPCION" ? "FIRMA DEL CLIENTE" : "CLIENTE — ENTREGA")
  if (sheet === "ENTREGA") {
    expect(out.text).toContain("TOTAL FINAL")
    expect(out.text).toContain("SALDO")
  }
}

describe("the fit never draws an overflowing page", () => {
  for (const key of ["A5", "A6"] as Compact[]) {
    for (const sheet of SHEETS) {
      it(`${key} ${sheet}: a 600-character warranty note still fits (slack >= 0, nothing overlaps)`, async () => {
        const garantia = { dias: 90, fechaVencimiento: new Date("2026-06-08T15:00:00.000Z"), notas: prose(600) }
        const out = await renderFit(key, { ...SHEET_ORDERS[sheet], garantia })
        expect(out.pages).toEqual([SIZES[key].page])
        expect(out.report, "the fit reports what it decided").toBeDefined()
        expect(out.report!.slack).toBeGreaterThanOrEqual(-0.01)
        expectNoClippingNoOverlap(out.runs, out.pages[0])
        expectCore(out, sheet)
      }, 20000)

      it(`${key} ${sheet}: every free-text field at 500 characters at once still fits, inside the page, nothing overlapping`, async () => {
        const out = await renderFit(key, { ...SHEET_ORDERS[sheet], ...everyFieldLong() })
        expect(out.pages).toEqual([SIZES[key].page])
        expect(out.report!.slack).toBeGreaterThanOrEqual(-0.01)
        expect(Math.min(...out.runs.map((r) => r.size))).toBeGreaterThanOrEqual(HARD_MIN - 0.01)
        expectNoClippingNoOverlap(out.runs, out.pages[0])
        expectCore(out, sheet)
      }, 20000)
    }
  }

  it("a tiny sheet of an ordinary order does not go anywhere near the guarantee", async () => {
    for (const key of ["A5", "A6"] as Compact[]) {
      const out = await renderFit(key, TYPICAL[key])
      expect(out.report!.step).toBe("normal")
      expect(out.report!.slack).toBeGreaterThanOrEqual(0)
    }
  })

  it("the number of measuring passes stays small even in the worst case", async () => {
    const out = await renderFit("A6", { ...SHEET_ORDERS.ENTREGA, ...everyFieldLong(), ...OVERFLOW_CASES["everything at once"]("A6") })
    expect(out.report!.attempts).toBeLessThan(120)
    expect(out.report!.slack).toBeGreaterThanOrEqual(-0.01)
  }, 20000)
})

describe("the very last resort: content that no font size can hold", () => {
  for (const key of ["A5", "A6"] as Compact[]) {
    for (const sheet of SHEETS) {
      it(`${key} ${sheet}: a contact phone of thousands of characters (a field that is never cut) still gives ONE page that fits`, async () => {
        const out = await renderFit(key, { ...SHEET_ORDERS[sheet], telefonoContacto: prose(key === "A5" ? 12000 : 3000) })
        expect(out.pages).toEqual([SIZES[key].page])
        expect(out.report!.step).toBe("guarantee")
        expect(out.report!.slack).toBeGreaterThanOrEqual(-0.01)
        expect(Math.min(...out.runs.map((r) => r.size))).toBeGreaterThanOrEqual(HARD_MIN - 0.01)
        expectNoClippingNoOverlap(out.runs, out.pages[0])
        expectCore(out, sheet)
      }, 20000)
    }
  }
})

describe("defensive limits on the small fixed fields", () => {
  for (const key of ["A5", "A6"] as Compact[]) {
    it(`${key}: an absurd order number and internal code cannot push the workshop name out of the header`, async () => {
      const out = await renderFit(key, { ...TYPICAL[key], numeroOrden: "9".repeat(400), codigoOrden: "C".repeat(300) })
      expect(out.pages).toEqual([SIZES[key].page])
      expectNoClippingNoOverlap(out.runs, out.pages[0])
      expect(out.text).toContain("Servicio Técnico Demo")
      expect(out.text).toContain("#" + "9".repeat(12))
      expect(out.text).not.toContain("9".repeat(13))
      expect(out.text).not.toContain("C".repeat(25))
    })

    it(`${key}: a checklist category title with no spaces wraps instead of running off the page`, async () => {
      const out = await renderFit(key, { ...ENTREGA, checklistItems: [{ label: "Pantalla", valor: true, categoria: "X".repeat(200) }] })
      expect(out.pages).toEqual([SIZES[key].page])
      expectNoClippingNoOverlap(out.runs, out.pages[0])
    })
  }
})

describe("the terms are never removed in silence", () => {
  for (const key of ["A5", "A6"] as Compact[]) {
    it(`${key}: when the terms are cut a line always says where to get the rest`, async () => {
      const out = await renderFit(key, { ...LEAN, recepcionTerminos: loremTerms(30), problemaReportado: prose(1200), observaciones: prose(1200) })
      expect(out.pages).toHaveLength(1)
      expect(out.text).toContain("Términos completos: pedíselos al taller.")
      expect(out.text).not.toContain("30. Lorem ipsum")
    }, 20000)

    it(`${key}: an order whose terms fit whole shows no such line`, async () => {
      const out = await renderFit(key, TYPICAL[key])
      expect(out.text).not.toContain("Términos completos")
    })
  }

  it("the terms body may go entirely, the line stays, even when everything else is at its limit", async () => {
    const out = await renderFit("A6", { ...SHEET_ORDERS.ENTREGA, ...everyFieldLong(), ...OVERFLOW_CASES["everything at once"]("A6") })
    expect(out.text).toContain("Términos completos: pedíselos al taller.")
  }, 20000)
})

describe("the reception checklist is liability evidence: detail first, then a summary, never silence", () => {
  const checklistItems = [
    { label: "Pantalla táctil funciona", valor: true, categoria: "FUNCIONAL" },
    { label: "Cámara trasera funciona", valor: false, categoria: "FUNCIONAL" },
    { label: "Estado de la carcasa", valor: "Rayones leves en el borde superior", categoria: "CONDICION_FISICA" },
  ]

  it("the fully populated delivered order on A5 keeps the checklist whole", async () => {
    const out = await renderFit("A5", ENTREGA)
    expect(out.text).toContain("Pantalla táctil funciona: OK")
    expect(out.text).toContain("Cámara trasera funciona: NO")
    expect(out.text).toContain("Estado de la carcasa: Rayones leves en el borde superior")
    expect(out.text).toContain("Accesorios entregados por el cliente: Cargador original, funda transparente")
    expect(out.text).not.toContain("Checklist de ingreso")
  })

  it("when it does not fit whole it becomes ONE summary line with the counts and the problem items, before the falla is touched", async () => {
    const out = await renderFit("A6", ENTREGA) // the stock delivered order: 6 checklist items, 150-character falla
    expect(out.report!.step).toBe("cut")
    expect(out.text).toContain(
      "Checklist de ingreso: 2 OK · 2 NO (Cámara trasera funciona, Puerto de carga funciona) · 2 con nota (Estado de la carcasa, Accesorios entregados por el cliente)",
    )
    expect(out.text).toContain("El equipo no enciende desde que se mojó levemente con la lluvia. Además, la pantalla parpadea de forma intermitente cada vez que se intenta reiniciarlo.")
    expect(out.text).not.toContain("Rayones leves en el borde superior")
  }, 20000)

  it("the summary comes after the terms body: it is gone and a line says where to get it", async () => {
    const out = await renderFit("A6", ENTREGA)
    expect(out.text).toContain("Checklist de ingreso")
    expect(out.text).toContain("Términos completos: pedíselos al taller.")
    expect(out.text).not.toContain("1. Conserve este comprobante")
  }, 20000)

  it("the names of the items that are not OK are shortened before the falla, and left out only after it gave all it can", async () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ label: `Revisión de la pieza número ${i + 1} del equipo`, valor: false, categoria: "FUNCIONAL" }))
    const out = await renderFit("A6", { ...ENTREGA, checklistItems: items, problemaReportado: prose(260) })
    expect(out.text).toContain("Checklist de ingreso: 0 OK · 6 NO")
    expect(out.report!.step).not.toBe("guarantee")
  }, 20000)

  it("a checklist that is never cut says nothing about a summary", async () => {
    const out = await renderFit("A5", { ...LEAN, ...ENTREGA, checklistItems })
    expect(out.text).toContain("Cámara trasera funciona: NO")
    expect(out.text).not.toContain("Checklist de ingreso")
  })

  it("an enormous checklist is still ONE page: the summary keeps its counts and cuts the names", async () => {
    const items = Array.from({ length: 80 }, (_, i) => ({ label: `Revisión número ${i + 1} del equipo`, valor: i % 4 !== 0, categoria: "FUNCIONAL" }))
    const out = await renderFit("A6", { ...SHEET_ORDERS.ENTREGA, checklistItems: items })
    expect(out.pages).toHaveLength(1)
    expect(out.report!.step).not.toBe("guarantee")
    expect(out.text).toContain("Checklist de ingreso: 60 OK · 20 NO")
  }, 20000)
})

describe("summarizeChecklist", () => {
  it("counts OK and NO and names the items that are not OK, comma separated", () => {
    const items = [
      { label: "Pantalla", valor: true },
      { label: "Cámara trasera", valor: false },
      { label: "Batería", valor: true },
      { label: "Puerto de carga", valor: false },
    ]
    expect(summarizeChecklist(items)).toBe("Checklist de ingreso: 2 OK · 2 NO (Cámara trasera, Puerto de carga)")
  })

  it("says only the OK count when nothing is wrong", () => {
    expect(summarizeChecklist([{ label: "A", valor: true }, { label: "B", valor: true }])).toBe("Checklist de ingreso: 2 OK")
  })

  it("items with a written value are notes, not OK or NO", () => {
    expect(summarizeChecklist([{ label: "Carcasa", valor: "rayones" }, { label: "Pantalla", valor: true }])).toBe(
      "Checklist de ingreso: 1 OK · 1 con nota (Carcasa)",
    )
  })

  it("cuts the names, never the counts, and drops the parentheses when no name is left", () => {
    const items = [{ label: "Cámara trasera con un nombre muy largo", valor: false }, { label: "Otro", valor: true }]
    expect(summarizeChecklist(items, 10)).toBe("Checklist de ingreso: 1 OK · 1 NO (Cámara tra…)")
    expect(summarizeChecklist(items, 0)).toBe("Checklist de ingreso: 1 OK · 1 NO")
  })
})

describe("an ordinary order never reaches the below-the-floor guarantee", () => {
  const FALLA = "El equipo no enciende desde que se mojó levemente con la lluvia. Además, la pantalla parpadea de forma intermitente cada vez que se intenta reiniciarlo."
  const DIAGNOSTICO = "Bateria agotada, se reemplaza por una nueva."
  // the extraction mangles the "fi" ligature, so compare without f, i and spaces
  const strip = (x: string) => x.replace(/[fi]/g, "").replace(/\s+/g, "")
  const termsText = strip(DEFAULT_RECEPCION_TERMINOS.join(" ") + " Términos completos: pedíselos al taller.")

  for (const [sheet, extra] of [["RECEPCION", {}], ["ENTREGA", ENTREGA]] as const) {
    it(`A6 ${sheet}: the stock fixture keeps the floors, the whole falla${sheet === "ENTREGA" ? " and diagnostico" : ""} and its checklist`, async () => {
      const out = await renderFit("A6", extra)
      expect(out.pages).toEqual([SIZES.A6.page])
      expect(out.report!.step, `reached ${out.report!.step} at scale ${out.report!.scale}`).not.toBe("guarantee")
      expect(out.report!.scale).toBeGreaterThanOrEqual(0.8)
      // everything but the terms is at the text floor or above
      const small = out.runs.filter((r) => r.size < FLOORS.A6.text - 0.01)
      for (const r of small) expect(termsText.includes(strip(r.text)), `"${r.text}" is under ${FLOORS.A6.text}pt and is not the terms`).toBe(true)
      expect(Math.min(...out.runs.map((r) => r.size))).toBeGreaterThanOrEqual(FLOORS.A6.terms - 0.01)
      expect(out.text).toContain(FALLA)
      if (sheet === "ENTREGA") {
        expect(out.text).toContain(DIAGNOSTICO)
        // the checklist: whole, or ONE summary line with the right counts and the problem items
        const whole = out.text.includes("Cámara trasera funciona: NO") && out.text.includes("Pantalla táctil funciona: OK")
        if (!whole) {
          expect(out.text).toContain("Checklist de ingreso: 2 OK · 2 NO (Cámara trasera funciona, Puerto de carga funciona) · 2 con nota (Estado de la carcasa, Accesorios entregados por el cliente)")
        }
        expect(out.text).toContain("Cámara trasera funciona")
        expect(out.text).toContain("Puerto de carga funciona")
      }
    }, 20000)
  }
})

describe("the rows that do not fit are summed exactly, and the totals are untouched", () => {
  // Cents on purpose, with negatives: 0.1 + 0.2 style float drift must not reach the paper.
  const cents = (i: number) => (((i * 7919) % 9973) - 1500 + (i % 3 === 0 ? 0.35 : 0.07)) / 1
  const items = Array.from({ length: 40 }, (_, i) => ({ nombre: `Item ${i + 1}`, cantidad: 1, importe: Math.round(cents(i) * 100) / 100 || 1.01 }))
  const pagos = Array.from({ length: 12 }, (_, i) => ({ fecha: FIXED, metodo: "EFECTIVO", referencia: null, monto: i === 5 ? -250.1 : Math.round((100.1 + i * 3.37) * 100) / 100 }))
  const sum = (xs: number[]) => xs.reduce((n, x) => n + Math.round(x * 100), 0) / 100

  for (const key of ["A5", "A6"] as Compact[]) {
    it(`${key}: "+N ítems más" and "+N pagos más" carry the exact sum of the rows they hide`, async () => {
      const costoFinal = Math.round((sum(items.map((i) => i.importe)) + 5000.55) * 100) / 100
      const out = await render(key, { ...LEAN, ...ENTREGA, trabajos: items, cobros: pagos, costoFinal, totalCobrado: sum(pagos.map((p) => p.monto)), presupuesto: 45000 })
      const itemsRow = /\+(\d+) ítems más (\S+ \S+)/.exec(out.text)
      const pagosRow = /\+(\d+) pagos más (\S+ \S+)/.exec(out.text)
      expect(itemsRow, "items were not collapsed: the test data is too small").not.toBeNull()
      expect(pagosRow, "payments were not collapsed: the test data is too small").not.toBeNull()
      const hiddenItems = Number(itemsRow![1])
      const hiddenPagos = Number(pagosRow![1])
      expect(out.text).toContain(norm(`+${hiddenItems} ítems más ${formatCurrencyValue(sum(items.slice(items.length - hiddenItems).map((i) => i.importe)), "ARS")}`))
      expect(out.text).toContain(norm(`+${hiddenPagos} pagos más ${formatCurrencyValue(sum(pagos.slice(pagos.length - hiddenPagos).map((p) => p.monto)), "ARS")}`))
      // what is shown is exactly the first rows, in order
      for (let i = 0; i < items.length - hiddenItems; i++) expect(out.text).toContain(`Item ${i + 1} x1`)
      expect(out.text).not.toContain(`Item ${items.length} x1`)
    }, 20000)

    it(`${key}: subtotal, total, deposit and balance read the same as without collapsing`, async () => {
      const subtotal = sum(items.map((i) => i.importe))
      const costoFinal = Math.round((subtotal + 5000.55) * 100) / 100
      const totalCobrado = sum(pagos.map((p) => p.monto))
      const out = await render(key, { ...LEAN, ...ENTREGA, trabajos: items, cobros: pagos, costoFinal, totalCobrado, presupuesto: 45000 })
      for (const piece of [
        `Subtotal trabajo ${formatCurrencyValue(subtotal, "ARS")}`,
        `Mano de obra y otros ${formatCurrencyValue(Math.round((costoFinal - subtotal) * 100) / 100, "ARS")}`,
        `TOTAL FINAL ${formatCurrencyValue(costoFinal, "ARS")}`,
        `SALDO ${formatCurrencyValue(Math.round((costoFinal - totalCobrado) * 100) / 100, "ARS")}`,
        `Presupuesto estimado ${formatCurrencyValue(45000, "ARS")}`,
      ]) {
        expect(out.text, `missing: ${piece}`).toContain(norm(piece))
      }
      // the deposit sheet: the deposit and the balance are not rows, so they are never summarised
      const recepcion = await render(key, { ...LEAN, trabajos: items, cobros: pagos })
      expect(recepcion.text).toContain(norm(`Seña abonada · EFECTIVO ${formatCurrencyValue(10000, "ARS")}`))
      expect(recepcion.text).toContain(norm(`Saldo estimado ${formatCurrencyValue(35000, "ARS")}`))
    }, 20000)
  }
})

describe("the last resort for names keeps the tax id", () => {
  for (const key of ["A5", "A6"] as Compact[]) {
    it(`${key}: a very long razón social is cut by itself; the CUIT after it survives`, async () => {
      const out = await renderFit(key, {
        ...OVERFLOW_CASES["everything at once"](key),
        cliente: { ...buildOrdenFixture().cliente, tipoCliente: "EMPRESA", razonSocial: prose(1500).replace(/ /g, "_"), cuit: "30-12345678-9", dni: null },
        nombreEmpresa: prose(900),
      })
      expect(out.pages).toHaveLength(1)
      expect(out.text).toContain("30-12345678-9")
      expect(out.report!.slack).toBeGreaterThanOrEqual(-0.01)
      expectNoClippingNoOverlap(out.runs, out.pages[0])
    }, 20000)
  }
})

describe("fonts of the heavy fixtures stay at or above their floors", () => {
  for (const key of ["A5", "A6"] as Compact[]) {
    for (const sheet of SHEETS) {
      it(`${key} ${sheet}: the fully populated order and the heavy ones are never drawn under the floors, the guarantee included`, async () => {
        for (const extra of [sheetExtra(sheet), { ...sheetExtra(sheet), ...OVERFLOW_CASES["everything at once"](key) }]) {
          const out = await renderFit(key, extra)
          // the guarantee is for absurd input only (see "the very last resort"), none of these is
          expect(out.report!.step, `reached ${out.report!.step} at scale ${out.report!.scale}`).not.toBe("guarantee")
          expect(Math.min(...out.runs.map((r) => r.size))).toBeGreaterThanOrEqual(FLOORS[key].terms - 0.01)
          const small = out.runs.filter((r) => r.size < FLOORS[key].text - 0.01)
          for (const r of small) expect(r.text, `"${r.text}" is under the text floor and is not terms`).toMatch(/Lorem|ipsum|dolor|consequat|…|Términos completos|^\d+\./i)
        }
      }, 20000)
    }
  }
})

// ---------------------------------------------------------------------------------------------
// The copy for the shop: a second page with what the A4 internal stub prints, the device access
// code included. The customer takes page 1 home, so the code is only ever on page 2.
// ---------------------------------------------------------------------------------------------

const SHOP_TITLE = "COPIA PARA EL LOCAL"

/** Renders for the shop (no `soloCliente`). `customerCopy` is overridden on purpose. */
async function renderShop(paper: Compact, overrides: Record<string, unknown> = {}) {
  const out = await render(paper, { soloCliente: false, ...overrides })
  const pageText = async (n: number) => {
    const single = await PDFDocument.create()
    const [copied] = await single.copyPages(out.doc, [n])
    single.addPage(copied)
    return (await extractPdfText(Buffer.from(await single.save()))).replace(/\s+/g, " ")
  }
  const runsOf = (n: number) => out.runs.filter((r) => r.page === n)
  return { ...out, pageText, runsOf }
}

describe("copy for the shop (second page of the A5 / A6 order)", () => {
  for (const key of ["A5", "A6"] as Compact[]) {
    describe(key, () => {
      it("a reception order printed for the shop has two pages of the sheet size", async () => {
        const out = await renderShop(key, { ...TYPICAL[key], codigoAccesoDispositivo: "PIN 4471" })
        expect(out.pages).toEqual([SIZES[key].page, SIZES[key].page])
      })

      it("page 2 is titled as the shop copy and carries the order number, the customer, the device and the PIN", async () => {
        const out = await renderShop(key, { ...TYPICAL[key], codigoAccesoDispositivo: "PIN 4471" })
        const shop = await out.pageText(1)
        expect(shop).toContain(SHOP_TITLE)
        expect(shop).toContain("#1042")
        expect(shop).toContain("Juan Pérez")
        expect(shop).toContain("iPhone 13")
        expect(shop).toContain("358400123456789")
        expect(shop).toMatch(/c[óo]digo de acceso/i)
        expect(shop).toContain("PIN 4471")
      })

      it("the access code is NOT on the customer page", async () => {
        const out = await renderShop(key, { ...TYPICAL[key], codigoAccesoDispositivo: "PIN 4471" })
        const customer = await out.pageText(0)
        expect(customer).not.toContain("4471")
        expect(customer).not.toMatch(/c[óo]digo de acceso/i)
        expect(customer).not.toContain(SHOP_TITLE)
      })

      it("a drawn unlock pattern renders on page 2 without crashing and never as text on page 1", async () => {
        const out = await renderShop(key, { ...TYPICAL[key], codigoAccesoDispositivo: "Patrón: 1-2-5-8-9" })
        expect(out.pages).toHaveLength(2)
        const shop = await out.pageText(1)
        expect(shop).toMatch(/c[óo]digo de acceso/i)
        expect(shop).toMatch(/patr[óo]n/i)
        expect(await out.pageText(0)).not.toMatch(/patr[óo]n/i)
      })

      it("no access code on the order: page 2 shows a dash, still two pages", async () => {
        const out = await renderShop(key, { ...TYPICAL[key], codigoAccesoDispositivo: null })
        expect(out.pages).toHaveLength(2)
        expect(await out.pageText(1)).toMatch(/c[óo]digo de acceso/i)
      })

      it("soloCliente (WhatsApp / customer share): one page, no shop copy, no access code anywhere", async () => {
        const out = await render(key, { ...TYPICAL[key], codigoAccesoDispositivo: "PIN 4471", soloCliente: true })
        expect(out.pages).toEqual([SIZES[key].page])
        expect(out.text).not.toContain("4471")
        expect(out.text).not.toContain(SHOP_TITLE)
      })

      it("a delivered order (ENTREGA) has no shop copy, like the A4 sheet has no stub", async () => {
        const out = await renderShop(key, { ...TYPICAL[key], ...ENTREGA, codigoAccesoDispositivo: "PIN 4471" })
        expect(out.pages).toHaveLength(1)
        expect(out.text).not.toContain("4471")
      })

      it("page 1 is the same customer copy with or without the shop page", async () => {
        const shop = await renderShop(key, { ...TYPICAL[key], codigoAccesoDispositivo: "PIN 4471" })
        const customer = await render(key, { ...TYPICAL[key], codigoAccesoDispositivo: "PIN 4471" })
        const strip = (runs: PositionedText[]) => runs.map(({ text, x, y, size, font }) => ({ text, x, y, size, font: font.replace(/-\d+$/, "") })) // embedded font names carry a random suffix
        expect(strip(shop.runsOf(0))).toEqual(strip(customer.runs))
      })

      it("a long falla, notes and checklist still fit page 2: two pages, nothing clipped or overlapping", async () => {
        const out = await renderShop(key, {
          ...TYPICAL[key],
          codigoAccesoDispositivo: "PIN 4471",
          problemaReportado: LOREM.repeat(6),
          observaciones: LOREM.repeat(4),
          tecnicoNombre: "Técnico con un nombre bastante largo para ocupar lugar",
          checklistItems: Array.from({ length: 40 }, (_, i) => ({ label: `Componente numero ${i + 1}`, valor: i % 3 !== 0, categoria: "FUNCIONAL" })),
          checklistNotas: LOREM,
        })
        expect(out.pages).toHaveLength(2)
        expect(await out.pageText(1)).toContain("PIN 4471")
        expectNoClippingNoOverlap(out.runsOf(1), out.pages[1])
      }, 20000)

      it("absurd names on page 2 are cut instead of leaving the page", async () => {
        const out = await renderShop(key, {
          ...TYPICAL[key],
          cliente: { ...buildOrdenFixture().cliente, nombre: "N".repeat(400) },
          dispositivo: "D".repeat(400),
          codigoAccesoDispositivo: "P".repeat(80),
        })
        expect(out.pages).toHaveLength(2)
        expectNoClippingNoOverlap(out.runsOf(1), out.pages[1])
      }, 20000)
    })
  }
})
