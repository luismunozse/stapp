// @vitest-environment node
import { describe, it, expect } from "vitest"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"

// VL-1: the legacy per-product variants surface is gone. The old model lived in the
// table `inventario_variantes` (migration 176) behind three RPCs, a row-menu dialog, a
// dashboard page and four routes. Nothing in the runtime code may reference it any more,
// so the M2 migration can drop the table without breaking a deployed caller.
//
// The catalog domain has its own `catalogo_variantes` and its own `tiene_variantes`
// flag. None of the needles below match them on purpose.

const ROOT = process.cwd()

/** Paths that must not exist any more (files and the directories that held them). */
const DELETED_PATHS = [
  "app/api/inventario/[id]/variantes/route.ts",
  "app/api/inventario/variantes/[varianteId]/route.ts",
  "app/api/inventario/variantes/[varianteId]/stock/route.ts",
  "app/api/inventario/[id]/consolidar-variantes/route.ts",
  "app/(dashboard)/inventario/variantes/[id]/page.tsx",
  "components/inventario/variantes-dialog.tsx",
  "__tests__/api/inventario-variantes-cost-gating.test.ts",
  "app/api/inventario/[id]/variantes",
  "app/api/inventario/variantes",
  "app/api/inventario/[id]/consolidar-variantes",
  "app/(dashboard)/inventario/variantes",
]

const LEGACY_NEEDLES = [
  "inventario_variantes",
  "crear_variantes_bulk",
  "ajustar_stock_variante_atomic",
  "eliminar_variantes_y_consolidar",
  "VariantesDialog",
]

const SCANNED_DIRS = ["app", "lib", "components", "types"]

/** Every .ts/.tsx file under `dir`, skipping `__tests__` folders and node_modules. */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "node_modules" || entry === ".next") continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

/** `file: needle` for every needle found in the files of `dirs`. */
function findNeedles(base: string, dirs: string[], needles: string[]): string[] {
  const hits: string[] = []
  for (const dir of dirs) {
    for (const file of sourceFiles(join(base, dir))) {
      const text = readFileSync(file, "utf8")
      for (const needle of needles) {
        if (text.includes(needle)) hits.push(`${relative(base, file).replace(/\\/g, "/")}: ${needle}`)
      }
    }
  }
  return hits
}

describe("legacy variants removal (VL-1)", () => {
  it.each(DELETED_PATHS)("%s no longer exists", (path) => {
    expect(existsSync(join(ROOT, path))).toBe(false)
  })

  it("no runtime code references the legacy table, its RPCs or the dialog", () => {
    expect(findNeedles(ROOT, SCANNED_DIRS, LEGACY_NEEDLES)).toEqual([])
  })

  it("the scan really walks the code base (it is not a ghost loop)", () => {
    const scanned = SCANNED_DIRS.flatMap((d) => sourceFiles(join(ROOT, d)))
    expect(scanned.length).toBeGreaterThan(200)
    // It must reach the nested route folder where the legacy files used to live.
    expect(scanned.some((f) => f.replace(/\\/g, "/").endsWith("app/api/inventario/grupos/[id]/route.ts"))).toBe(true)
  })
})

describe("the scanner itself", () => {
  it("reports a planted needle and skips __tests__ folders", () => {
    const base = mkdtempSync(join(tmpdir(), "legacy-scan-"))
    try {
      mkdirSync(join(base, "lib", "__tests__"), { recursive: true })
      writeFileSync(join(base, "lib", "dirty.ts"), 'const t = "inventario_variantes"\n')
      writeFileSync(join(base, "lib", "clean.ts"), "export const ok = 1\n")
      writeFileSync(join(base, "lib", "__tests__", "ignored.ts"), 'const t = "crear_variantes_bulk"\n')

      expect(findNeedles(base, ["lib"], LEGACY_NEEDLES)).toEqual(["lib/dirty.ts: inventario_variantes"])
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it("does not flag the catalog domain, which has its own variants table", () => {
    const base = mkdtempSync(join(tmpdir(), "legacy-scan-"))
    try {
      mkdirSync(join(base, "app"), { recursive: true })
      writeFileSync(join(base, "app", "catalogo.ts"), 'from("catalogo_variantes"); const tiene_variantes = 1\n')

      expect(findNeedles(base, ["app"], LEGACY_NEEDLES)).toEqual([])
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})
