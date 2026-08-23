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
// and string. That covers glyph placement, wrapping, truncation and vertical
// flow.
//
// WHAT IT DOES NOT COMPARE: anything that draws no text — the frame borders,
// the letter box's own rectangle, the ruled table cells, the logo bitmap's
// painted size, z-order. Task 7 moves the items/pagos tables, which are made
// almost entirely of ruled rectangles, so extending this to graphics
// operators is likely worth it there. Build that from
// __tests__/lib/pdf-text-helper.ts, which already decompresses content
// streams with pdf-lib + node's zlib. Do NOT reach for `qpdf --qdf`: it is
// not installed in this environment and must not become a new system
// dependency.
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

/** Human-readable differences between two dumps; empty means identical. */
export function diffDumps(base: GoldenDump, head: GoldenDump, maxPorFixture = 20): string[] {
  const salida: string[] = []
  const nombres = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort()

  for (const nombre of nombres) {
    const a = base[nombre] ?? []
    const b = head[nombre] ?? []
    if (a.length === b.length && a.every((linea, i) => linea === b[i])) continue

    salida.push(`${nombre}: ${a.length} -> ${b.length} text items`)
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
