import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"

/**
 * No source file may carry a raw NUL byte.
 *
 * This is not cosmetic. ripgrep sniffs for NUL to decide whether a file is
 * binary; one such byte and `rg` reports "binary file matches" and prints ZERO
 * lines, so the file silently drops out of every project-wide search. This
 * repo's conventions mandate rg, which means an invisible byte can hide a whole
 * route from every future sweep — the exact failure mode that let sibling
 * routes go ungated.
 *
 * It is also a correctness trap in review. `git diff` renders NUL as a plain
 * space, so a separator written as a raw NUL reads in the PR as a space
 * separator. Any editor or formatter that strips control characters would then
 * silently turn a safe key into a space-separated one — and descriptions
 * contain spaces, so that key would collide.
 *
 * Write the escape sequence instead of the literal character. It is the same
 * value at runtime and it survives search, diff and reformatting.
 */

const ROOT = resolve(__dirname, "..")
const SCANNED_DIRS = ["app", "components", "lib", "hooks", "contexts", "__tests__", "e2e", "scripts"]
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage"])

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

describe("source hygiene — no raw NUL bytes", () => {
  const files = SCANNED_DIRS.flatMap((d) => collectSourceFiles(join(ROOT, d)))

  it("scans a non-trivial set of source files", () => {
    // Guards the guard: a broken walk would make the assertion below vacuous.
    expect(files.length).toBeGreaterThan(100)
  })

  it("finds no file containing a raw NUL byte", () => {
    const offenders = files
      .map((file) => {
        const buf = readFileSync(file)
        const index = buf.indexOf(0)
        return index === -1 ? null : `${file.slice(ROOT.length + 1)} (byte offset ${index})`
      })
      .filter((entry): entry is string => entry !== null)

    expect(offenders).toEqual([])
  })
})
