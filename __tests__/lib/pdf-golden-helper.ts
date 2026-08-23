// ─── Position-level golden comparison for the A4 react-pdf documents ───
//
// WHY THIS EXISTS, given that remito-react-pdf.test.ts already has 43 tests:
// those suites assert CONTENT ("the header says CUIT: 30-...") and a handful
// of loose band checks ("the X sits above y=700"). They are the right shape
// for behaviour, and they are structurally blind to the failure mode a pure
// refactor actually has — the layout moving while every string survives.
//
// During the task-5 shell extraction this harness caught four output changes
// that the full suite waved through green:
//   1. pinning the remito's right zone shrank the reserved logo box from
//      80pt to ~49pt (yoga shrinks a starved flex child) and re-wrapped
//      company names onto two lines;
//   2. adopting the recibo's leftZone padding re-wrapped a long dirección;
//   3. dropping the cliente band's 6pt bottom padding shifted the entire
//      remito body up by 6pt;
//   4. treating an empty document number as "no number row" shifted the
//      body up by the row's own 2pt margin.
// None of those changed a single character of extracted text.
//
// HOW TO USE IT (two runs, one diff):
//
//   # on the base commit
//   PDF_GOLDEN=1 PDF_GOLDEN_OUT=.tmp-preview/golden-base.json \
//     npx vitest run __tests__/pdf-golden.test.ts
//
//   # after the change
//   PDF_GOLDEN=1 PDF_GOLDEN_OUT=.tmp-preview/golden-head.json \
//     PDF_GOLDEN_BASE=.tmp-preview/golden-base.json \
//     npx vitest run __tests__/pdf-golden.test.ts
//
// The second run fails, listing the offending fixtures and item slots, if any
// text item moved. `.tmp-preview/` is gitignored. The dumps are deliberately
// NOT committed as a checked-in baseline: they would need regeneration on
// every intentional design change and on any @react-pdf/renderer bump, which
// turns a sharp refactor instrument into a chronically stale test.
//
// WHAT IT COMPARES: every extracted text item's page, x, y (rounded to 0.01pt)
// and string (dumpPositions). That covers glyph placement, wrapping,
// truncation and vertical flow. PLUS, since task 7, the page content streams'
// graphics operators (dumpGraphics) — see below.
//
// WHY GRAPHICS TOO: task 7 moved the items/pagos/movimientos tables into one
// shared <Tabla>. A table is made almost entirely of ruled rectangles and
// borders, which emit NO text: a shifted column border, a lost cell divider
// or a changed border colour is completely invisible to dumpPositions. For
// that task a clean text run was much weaker evidence than it had been for
// tasks 3-6, so the harness grew a second dump built the way this file's
// earlier note suggested — pdf-lib + node's zlib over the page content
// streams (the pattern in __tests__/lib/pdf-text-helper.ts), never `qpdf
// --qdf`, which is not installed here and must not become a system
// dependency.
//
// WHAT IT STILL DOES NOT COMPARE. Read this list before trusting a green run:
// a harness that overstates its own coverage is how the next person gets
// burned. Every entry below was checked against the code, and the first two
// were confirmed by mutation.
//
//   1. FONT SELECTION AND SIZE. `Tf` is excluded from dumpGraphics (it is a
//      text operator) and extractReactPdfTextPositions keeps only `str` plus
//      transform[4]/[5], discarding pdfjs's own `fontName`. So a font-WEIGHT
//      change is invisible to BOTH dumps whenever it does not move a glyph
//      origin — which is the normal case for a left-aligned cell. Verified:
//      adding `bold: true` to the resumen's left-aligned FECHA column renders
//      every date in the statement in Helvetica-Bold across all three pages of
//      resumen/03-multipagina, and the whole harness stays green. (A
//      right-aligned column would be caught, but only incidentally, because
//      right-alignment derives the origin from the measured width.) A font
//      SIZE change usually shifts y, but that is a side effect, not coverage.
//      To close this, resolve each `Tf`'s font resource name through the
//      page's /Font dict to its BaseFont before recording it — the raw /F1,
//      /F2 names are assignment-order dependent and would diff spuriously.
//   2. GLYPH ADVANCE STATE: `Tc`, `Tw`, `Tz`, `Ts`, `Tr`. Excluded from
//      dumpGraphics with the rest of the text operators, and they change how
//      glyphs advance rather than where a run starts, so dumpPositions misses
//      them too.
//   3. EMPTY AND WHITESPACE-ONLY TEXT RUNS, dropped by the `.str.trim()`
//      filter in extractReactPdfTextPositions.
//   4. THE "Impreso:" FOOTER LINE, dropped on purpose — it carries the wall
//      clock and is the only nondeterministic string these documents render.
//   5. THE BYTES OF EMBEDDED IMAGES. Only the `Do` invocation and the CTM
//      that sizes and places it are recorded.
//   6. EVERYTHING OUTSIDE THE PAGE CONTENT STREAM: link annotations, outlines,
//      document metadata, page rotation and MediaBox.
//
// Text FILL COLOUR is covered, despite being a text attribute: react-pdf sets
// it with the same `cs`/`scn` operators a path uses, and this walker records
// those wherever they appear, inside a text object or not. Verified by
// mutating estilosShell.tablaHeaderCell's colour from MONO.label to MONO.ink
// and watching the graphics dump fail.
import { PDFDocument, PDFName, PDFDict, PDFStream, PDFArray, type PDFPage } from "pdf-lib"
import zlib from "zlib"
import { extractReactPdfTextPositions } from "./pdf-text-helper-react"

export type GoldenDump = Record<string, string[]>

const redondear = (n: number) => Math.round(n * 100) / 100

/**
 * One comparable line per text item. The footer's "Impreso: <wall clock>"
 * carries the current time and is dropped — it is the only nondeterministic
 * string these documents render.
 */
export async function dumpPositions(buffer: Buffer): Promise<string[]> {
  const items = await extractReactPdfTextPositions(buffer)
  return items
    .filter((i) => !i.text.startsWith("Impreso:"))
    .map((i) => `p${i.page} x${redondear(i.x)} y${redondear(i.y)} :: ${i.text}`)
}

// ─── Graphics-operator dump ───────────────────────────────────────────────
//
// Everything below reads the page content streams directly. react-pdf draws
// every rule, border, cell divider and table frame as a path — `re` (or
// `m`/`l`/`c`) followed by a painting operator — under a CTM set by `cm`, with
// the stroke width from `w` and the colours from `RG`/`rg`. None of that emits
// a single glyph, so it is exactly the blind spot dumpPositions has.

/**
 * COORDINATES ARE RESOLVED TO PAGE SPACE, and this is the whole design.
 *
 * A raw operator dump compares the element tree, not the picture. Wrapping a
 * table cell's <Text> in a <View> adds a `q` / `cm` / `Q` triple around it and
 * splits one translation into two, without moving a single point of ink — the
 * first run of this harness against task 7's own change reported 264 "extra"
 * operators that all resolved to the same page coordinates. That is noise, and
 * a harness that cries wolf on nesting gets ignored on the day it is right.
 *
 * So `q`/`Q`/`cm` are consumed rather than emitted: this walker keeps a CTM
 * stack and transforms every path coordinate into page space before recording
 * it. An unbalanced `Q` or a wrong `cm` still fails — loudly — because every
 * coordinate after it lands somewhere else.
 *
 * What IS emitted, and why each matters to a ruled table:
 *   - path construction, in page coordinates: m l c v y h re
 *   - painting/clipping: S s f F f* B B* b b* n W W*
 *   - colour: CS cs SC SCN sc scn RG rg G g K k
 *   - stroke width (scaled by the CTM) and dash pattern: w d
 *   - other state that changes how a path paints: gs J j M i ri
 *   - XObjects and shadings, with the CTM that sizes them: Do sh
 * Text operators are deliberately excluded — dumpPositions already owns them.
 *
 * CS/cs + SCN/scn are the ones that actually matter for these documents:
 * react-pdf (pdfkit) never emits RG/rg for a border colour, it selects
 * /DeviceRGB and then sets the components with SCN/scn. Leaving those two out
 * made the whole dump blind to colour — verified by mutating a table's
 * borderRightColor from MONO.ink to MONO.rule and watching the harness stay
 * green. RG/rg/G/g/K/k are kept anyway so a renderer bump that switches
 * notation does not silently reopen the hole.
 */

/** operator -> how many trailing operands are (x, y) pairs to transform. */
const PUNTOS_POR_OPERADOR: Record<string, number> = { m: 1, l: 1, c: 3, v: 2, y: 2 }

const OPERADORES_SIN_COORDENADAS = new Set([
  "h",
  "S", "s", "f", "F", "f*", "B", "B*", "b", "b*", "n",
  "W", "W*",
  "CS", "cs", "SC", "SCN", "sc", "scn", "RG", "rg", "G", "g", "K", "k",
  "gs", "d", "J", "j", "M", "i", "ri",
  "sh",
])

const DELIMITADORES = /[\s()<>[\]{}/%]/

/**
 * Minimal PostScript-style lexer for a content stream.
 *
 * A naive whitespace split cannot be used: literal strings `(...)` may contain
 * spaces, escaped parens and even the bytes "BT"/"ET", so stripping text
 * blocks with a regex before splitting is not safe either. String and hex-
 * string payloads are collapsed to a placeholder — their content belongs to
 * the text dump, and keeping it here would make the graphics dump fail for
 * text-only reasons.
 */
function tokenizar(s: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === "%") {
      while (i < s.length && s[i] !== "\n" && s[i] !== "\r") i++
      continue
    }
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (c === "(") {
      let profundidad = 1
      let j = i + 1
      while (j < s.length && profundidad > 0) {
        if (s[j] === "\\") {
          j += 2
          continue
        }
        if (s[j] === "(") profundidad++
        else if (s[j] === ")") profundidad--
        j++
      }
      tokens.push("(str)")
      i = j
      continue
    }
    if (c === "<" && s[i + 1] === "<") {
      tokens.push("<<")
      i += 2
      continue
    }
    if (c === ">" && s[i + 1] === ">") {
      tokens.push(">>")
      i += 2
      continue
    }
    if (c === "<") {
      const j = s.indexOf(">", i)
      tokens.push("<hex>")
      i = j === -1 ? s.length : j + 1
      continue
    }
    if (c === "[" || c === "]" || c === "{" || c === "}") {
      tokens.push(c)
      i++
      continue
    }
    // Names (/Foo) keep their leading slash so an operand list stays readable.
    let j = c === "/" ? i + 1 : i
    while (j < s.length && !DELIMITADORES.test(s[j])) j++
    if (j === i) j++ // never stall on an unexpected delimiter
    tokens.push(s.slice(i, j))
    i = j
  }
  return tokens
}

const esOperando = (t: string) =>
  t === "[" ||
  t === "]" ||
  t === "<<" ||
  t === ">>" ||
  t === "(str)" ||
  t === "<hex>" ||
  t === "true" ||
  t === "false" ||
  t === "null" ||
  t.startsWith("/") ||
  /^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)

const esNumero = (t: string) => /^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)

/** Rounds numeric operands to 0.01pt, the same tolerance dumpPositions uses. */
const normalizarOperando = (t: string) => (esNumero(t) ? String(redondear(parseFloat(t))) : t)

// ─── CTM arithmetic (row-vector convention, as PDF defines it) ───
// A matrix is [a b c d e f]; a point maps to (a·x + c·y + e, b·x + d·y + f).
type Matriz = [number, number, number, number, number, number]

const IDENTIDAD: Matriz = [1, 0, 0, 1, 0, 0]

/** `cm` concatenation: the new matrix is applied BEFORE the current one. */
function concatenar(m: Matriz, ctm: Matriz): Matriz {
  const [a, b, c, d, e, f] = m
  const [A, B, C, D, E, F] = ctm
  return [
    a * A + b * C,
    a * B + b * D,
    c * A + d * C,
    c * B + d * D,
    e * A + f * C + E,
    e * B + f * D + F,
  ]
}

const aplicar = (ctm: Matriz, x: number, y: number): [number, number] => [
  ctm[0] * x + ctm[2] * y + ctm[4],
  ctm[1] * x + ctm[3] * y + ctm[5],
]

/** Uniform scale a CTM applies, used to report stroke widths in page points. */
const escala = (ctm: Matriz) => Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]))

const punto = (ctm: Matriz, x: number, y: number) => {
  const [px, py] = aplicar(ctm, x, y)
  return `${redondear(px)},${redondear(py)}`
}

/**
 * Decompresses a page's content stream(s). Unlike pdf-text-helper's version
 * this checks the /Filter instead of assuming FlateDecode: whether pdfkit
 * compresses is a renderer option, and an uncompressed stream must not throw.
 */
function contenidoDePagina(loaded: PDFDocument, page: PDFPage): string {
  const contentsRef = page.node.Contents()
  if (!contentsRef) return ""
  const streams =
    contentsRef instanceof PDFArray
      ? Array.from({ length: contentsRef.size() }, (_, i) => loaded.context.lookup(contentsRef.get(i), PDFStream))
      : [loaded.context.lookup(contentsRef, PDFStream)]

  return streams
    .map((s) => {
      const bytes = Buffer.from(s.getContents())
      const filtro = s.dict.get(PDFName.of("Filter"))
      const nombres = filtro instanceof PDFArray ? filtro.asArray().map(String) : [String(filtro ?? "")]
      return nombres.includes("/FlateDecode") ? zlib.inflateSync(bytes).toString("latin1") : bytes.toString("latin1")
    })
    .join("\n")
}

/**
 * One comparable line per painting-relevant operator: `p<page> <op> <args>`,
 * in stream order, with every coordinate already resolved to page space.
 * Order matters as much as the values do — a table's borders are painted in a
 * fixed sequence, and a reordered stream is a real change.
 */
export async function dumpGraphics(buffer: Buffer): Promise<string[]> {
  const loaded = await PDFDocument.load(buffer)
  const salida: string[] = []

  for (let p = 0; p < loaded.getPageCount(); p++) {
    const page = loaded.getPage(p)
    const tokens = tokenizar(contenidoDePagina(loaded, page))

    let ctm: Matriz = IDENTIDAD
    const pila: Matriz[] = []
    let operandos: string[] = []

    for (const token of tokens) {
      if (esOperando(token)) {
        operandos.push(normalizarOperando(token))
        continue
      }
      const args = operandos
      // Any operator ends the current operand run, recorded or not.
      operandos = []

      if (token === "q") {
        pila.push(ctm)
        continue
      }
      if (token === "Q") {
        ctm = pila.pop() ?? IDENTIDAD
        continue
      }
      if (token === "cm" && args.length >= 6) {
        ctm = concatenar(args.slice(-6).map(parseFloat) as Matriz, ctm)
        continue
      }

      const pares = PUNTOS_POR_OPERADOR[token]
      if (pares !== undefined && args.length >= pares * 2) {
        const coords = args.slice(-pares * 2).map(parseFloat)
        const puntos: string[] = []
        for (let i = 0; i < pares; i++) puntos.push(punto(ctm, coords[i * 2], coords[i * 2 + 1]))
        salida.push(`p${p + 1} ${token} ${puntos.join(" ")}`)
        continue
      }

      if (token === "re" && args.length >= 4) {
        // Emit all four transformed corners: under a flip or a rotation a
        // rect's own w/h say nothing about where its edges land.
        const [x, y, w, h] = args.slice(-4).map(parseFloat)
        const esquinas = [
          punto(ctm, x, y),
          punto(ctm, x + w, y),
          punto(ctm, x + w, y + h),
          punto(ctm, x, y + h),
        ]
        salida.push(`p${p + 1} re ${esquinas.join(" ")}`)
        continue
      }

      if (token === "w" && args.length >= 1) {
        salida.push(`p${p + 1} w ${redondear(parseFloat(args[args.length - 1]) * escala(ctm))}`)
        continue
      }

      if (token === "Do") {
        // The CTM is what sizes and places an XObject — the logo bitmap's
        // painted box lives here and nowhere else in either dump.
        salida.push(`p${p + 1} Do ${args.join(" ")} @ ${ctm.map(redondear).join(" ")}`)
        continue
      }

      if (OPERADORES_SIN_COORDENADAS.has(token)) {
        salida.push(`p${p + 1} ${token} ${args.join(" ")}`.trimEnd())
      }
    }

    if (pila.length !== 0) salida.push(`p${p + 1} UNBALANCED q/Q: ${pila.length} left on the stack`)
  }

  // Resources are what a `Do` actually invokes; a table never touches them,
  // but a lost ExtGState (opacity, blend mode) would show up here and nowhere
  // else in either dump.
  for (let p = 0; p < loaded.getPageCount(); p++) {
    const recursos = loaded.getPage(p).node.Resources()
    const extG = recursos?.lookup(PDFName.of("ExtGState"), PDFDict)
    if (extG) salida.push(`p${p + 1} ExtGState keys: ${[...extG.keys()].map(String).sort().join(",")}`)
  }

  return salida
}

/** Human-readable differences between two dumps; empty means identical. */
export function diffDumps(base: GoldenDump, head: GoldenDump, maxPorFixture = 20): string[] {
  const salida: string[] = []
  const nombres = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort()

  for (const nombre of nombres) {
    const a = base[nombre] ?? []
    const b = head[nombre] ?? []
    if (a.length === b.length && a.every((linea, i) => linea === b[i])) continue

    // `nombre` carries a " [gfx]" suffix (see pdf-golden.test.ts's `registrar`)
    // for the graphics-operator slot; every other slot is a text-position dump.
    const unidad = nombre.endsWith(" [gfx]") ? "graphics operators" : "text items"
    salida.push(`${nombre}: ${a.length} -> ${b.length} ${unidad}`)
    let mostrados = 0
    for (let i = 0; i < Math.max(a.length, b.length) && mostrados < maxPorFixture; i++) {
      if (a[i] !== b[i]) {
        salida.push(`  [${i}] base ${a[i] ?? "(none)"}`)
        salida.push(`  [${i}] head ${b[i] ?? "(none)"}`)
        mostrados++
      }
    }
  }
  return salida
}
