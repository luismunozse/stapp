import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join, resolve, relative } from "node:path"

/**
 * `cotizaciones` has TWO foreign keys pointing at `ordenes_servicio`:
 * `cotizaciones.orden_id` (001_schema) and `cotizaciones.convertida_a_orden_id`
 * (migration 126). PostgREST refuses to guess between them: a bare
 * `cotizaciones (...)` embed inside a `from("ordenes_servicio")` select answers
 * HTTP 300 / PGRST201 instead of rows.
 *
 * Every caller swallows that error as "no rows", so the symptom surfaces as a
 * misleading 404 ("Orden no encontrada") or an empty report — never as a
 * schema error. A mock-based route test cannot reproduce it, because the mock
 * never parses the select string. Hence this static sweep: it reads the actual
 * select text and fails on any embed that leaves the relationship ambiguous.
 *
 * Fix shape: name the FK — `cotizaciones!cotizaciones_orden_id_fkey (...)`.
 */

const ROOT = resolve(__dirname, "..", "..")
const SCANNED_DIRS = ["app", "lib", "components", "hooks", "contexts", "scripts"]
const SOURCE_EXT = /\.(ts|tsx|mjs)$/
const SKIP_DIRS = new Set(["node_modules", ".next", ".worktrees", ".claude", "dist", "build", "coverage"])

const FROM_ORDENES = /\.from\(\s*["'`]ordenes_servicio["'`]\s*\)/g
const BARE_EMBED = /(?<![A-Za-z0-9_!])cotizaciones\s*\(/

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      collectSourceFiles(join(dir, entry.name), out)
    } else if (SOURCE_EXT.test(entry.name)) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

// The select text of a query: from the `.from("ordenes_servicio")` call up to
// the next `.from(` in the file (or EOF), which is where the next query starts.
function selectBlocks(content: string): string[] {
  const blocks: string[] = []
  for (const match of content.matchAll(FROM_ORDENES)) {
    const start = match.index! + match[0].length
    const nextFrom = content.indexOf(".from(", start)
    blocks.push(content.slice(start, nextFrom === -1 ? content.length : nextFrom))
  }
  return blocks
}

describe("ordenes_servicio → cotizaciones embeds", () => {
  it("always name the FK, so PostgREST does not answer PGRST201", () => {
    const offenders: string[] = []

    for (const dir of SCANNED_DIRS) {
      for (const file of collectSourceFiles(join(ROOT, dir))) {
        const content = readFileSync(file, "utf8")
        for (const block of selectBlocks(content)) {
          if (BARE_EMBED.test(block)) {
            offenders.push(relative(ROOT, file).split("\\").join("/"))
            break
          }
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
