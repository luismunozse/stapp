import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

// Every code path that inserts real orders must delete the onboarding practice
// afterwards (spec: "deleted when the first real order is created").
const ROOT = process.cwd()
const SCAN = ["app", "lib"]
const INSERTA_ORDEN = /\.from\(\s*["']ordenes_servicio["']\s*\)\s*\.insert\(|rpc\(\s*["']crear_recepcion_multiple["']/

// Inserts that are not a shop's real work.
const EXENTOS = new Set([
  "app/api/onboarding/practica/route.ts", // the practice itself
  "app/api/onboarding/seed-demo-data/route.ts", // demo data, explicit action
  "lib/onboarding/sample-data.ts", // sample data, explicit action
])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".") || name === "__tests__") continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

describe("real-order insert paths", () => {
  it("all call deletePracticeData", () => {
    const sinBorrado = SCAN.flatMap((d) => walk(join(ROOT, d)))
      .map((f) => ({ rel: relative(ROOT, f).split(sep).join("/"), src: readFileSync(f, "utf8") }))
      .filter(({ rel, src }) => INSERTA_ORDEN.test(src) && !EXENTOS.has(rel) && !src.includes("deletePracticeData("))
      .map(({ rel }) => rel)
      .sort()
    expect(sinBorrado).toEqual([])
  })
})
