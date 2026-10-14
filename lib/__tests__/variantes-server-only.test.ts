// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "fs"
import { join, relative, sep } from "path"
import { describe, it, expect } from "vitest"

// lib/variantes-api.ts is the server half of the group save (RPC error map, retry, HTTP
// answers): it imports next/server and carries `import "server-only"`. Only route handlers may
// import it; the product form imports the pure lib/variantes-schema.ts instead.

const RAIZ = process.cwd()
const SALTAR = new Set(["node_modules", ".next", ".git", ".worktrees", "__tests__"])

function archivos(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((nombre) => {
    if (SALTAR.has(nombre)) return []
    const ruta = join(dir, nombre)
    if (statSync(ruta).isDirectory()) return archivos(ruta)
    return /\.(ts|tsx)$/.test(nombre) ? [ruta] : []
  })
}

const IMPORTA_API = /(?:from\s+|import\s*\(\s*|import\s+)["']@\/lib\/variantes-api["']/
const rel = (ruta: string) => relative(RAIZ, ruta).split(sep).join("/")

describe("lib/variantes-api.ts is server-only", () => {
  it("starts with import \"server-only\"", () => {
    const fuente = readFileSync(join(RAIZ, "lib/variantes-api.ts"), "utf8").replace(/\r\n/g, "\n")
    const primera = fuente.split("\n").find((linea) => linea.trim() !== "" && !linea.trim().startsWith("//"))
    expect(primera).toBe('import "server-only"')
  })

  const todos = ["app", "components", "hooks", "lib", "contexts", "providers"].flatMap((d) => archivos(join(RAIZ, d)))

  it("scans a real tree (the sweep is not vacuous)", () => {
    expect(todos.length).toBeGreaterThan(300)
    expect(todos.map(rel)).toContain("lib/variantes-api.ts")
  })

  it("only route handlers under app/api import it", () => {
    const importadores = todos.filter((f) => IMPORTA_API.test(readFileSync(f, "utf8"))).map(rel)
    const fuera = importadores.filter((f) => !/^app\/api\/.+\/route\.ts$/.test(f))
    expect(fuera).toEqual([])
  })

  it("no client component (\"use client\") imports it", () => {
    const clientes = todos.filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8")))
    expect(clientes.length).toBeGreaterThan(50)
    const ofensores = clientes.filter((f) => IMPORTA_API.test(readFileSync(f, "utf8"))).map(rel)
    expect(ofensores).toEqual([])
  })

  it("the detector itself recognizes the import forms", () => {
    expect(IMPORTA_API.test('import { x } from "@/lib/variantes-api"')).toBe(true)
    expect(IMPORTA_API.test("import {\n  x,\n} from '@/lib/variantes-api'")).toBe(true)
    expect(IMPORTA_API.test('const m = await import("@/lib/variantes-api")')).toBe(true)
    expect(IMPORTA_API.test('import "@/lib/variantes-api"')).toBe(true)
    expect(IMPORTA_API.test('import { x } from "@/lib/variantes-schema"')).toBe(false)
  })
})
