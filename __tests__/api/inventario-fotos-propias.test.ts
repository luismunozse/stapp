// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "fs"
import { join, relative, sep } from "path"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/catalogo/revalidate", () => ({ revalidateCatalogo: vi.fn() }))
vi.mock("@/lib/variantes-fotos", () => ({ adjuntarFotoDeRespaldo: vi.fn(async (_org: string, items: unknown[]) => items) }))

import { adjuntarFotoDeRespaldo } from "@/lib/variantes-fotos"
import { POST as importarAlCatalogo } from "@/app/api/catalogo/items/import-inventario/route"

// PI-3: the fallback photo of a variant is shown ONLY on the inventory list, the group form and
// the POS variants sheet. Every other surface uses the product's OWN photo or none.

type Fila = Record<string, any>

describe("catalog import: a variant without its own photo gets no photo (VI-6 S2)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
  })

  it("inserts imagen_url null and no gallery for an Azul whose sibling has a photo, and never asks for a fallback", async () => {
    const tablas: string[] = []
    const selects: string[] = []
    let insertado: Fila[] = []
    vi.mocked(supabaseAdmin.from).mockImplementation(((tabla: string) => {
      tablas.push(tabla)
      const q: any = {}
      for (const m of ["eq", "in", "order", "limit"]) q[m] = vi.fn(() => q)
      q.select = vi.fn((columnas: string) => (selects.push(`${tabla}:${columnas}`), q))
      q.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }))
      q.insert = vi.fn((filas: Fila[]) => ((insertado = filas), q))
      q.then = (resolve: any, reject?: any) => {
        const data =
          tabla === "inventario"
            ? // Azul has no photo; its sibling Rojo (not selected) has one.
              [{ id: "azul", nombre: "Funda X - Azul", descripcion: null, precio_venta: 12000 }]
            : tabla === "catalogo_items" && insertado.length > 0
              ? [{ id: "cat-1" }]
              : []
        return Promise.resolve({ data, error: null }).then(resolve, reject)
      }
      return q
    }) as any)

    const { status, body } = await parseResponse(await importarAlCatalogo(createPostRequest({ inventarioIds: ["azul"] })))

    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, creados: 1 })
    expect(insertado).toHaveLength(1)
    expect(insertado[0]).toMatchObject({ inventario_id: "azul", imagen_url: null, imagenes: [] })
    // The import neither reads the group tables nor the photo columns, and never computes a fallback.
    expect(tablas).not.toContain("inventario_grupos")
    expect(selects.filter((s) => s.startsWith("inventario:")).every((s) => !s.includes("imagen"))).toBe(true)
    expect(adjuntarFotoDeRespaldo).not.toHaveBeenCalled()
  })
})

// PI-3: the fallback photo is shown ONLY on the inventory list, the group form and the POS
// variants sheet. Every other surface (exports, v1, webhooks, conteos, kits, labels, catalog,
// tickets) uses the OWN photo or none, so none of them may reach the fallback code. Rather than
// run each of those routes, this pins who can reach it at all: the lookup and the pure functions
// are used only by the places below. A new consumer has to be added here on purpose (PR13 adds
// the POS search route for the variants sheet).
describe("who can reach the fallback photo code (PI-3)", () => {
  const RAIZ = process.cwd()
  const SALTAR = new Set(["node_modules", ".next", ".git", ".worktrees", "__tests__"])
  const rel = (ruta: string) => relative(RAIZ, ruta).split(sep).join("/")
  function archivos(dir: string): string[] {
    if (!existsSync(dir)) return []
    return readdirSync(dir).flatMap((nombre) => {
      if (SALTAR.has(nombre)) return []
      const ruta = join(dir, nombre)
      if (statSync(ruta).isDirectory()) return archivos(ruta)
      return /\.(ts|tsx)$/.test(nombre) ? [ruta] : []
    })
  }

  const SIMBOLOS = /\b(adjuntarFotoDeRespaldo|imagenRespaldoDe|fotoDeRespaldo)\b/
  const PERMITIDOS = [
    "lib/variantes.ts", // defines the pure functions
    "lib/variantes-fotos.ts", // defines the lookup
    "app/api/inventario/route.ts", // the inventory list
    "app/api/inventario/grupos/[id]/route.ts", // the group read (form)
    "app/api/inventario/search/route.ts", // the POS variants sheet (grupoId mode only)
  ]
  const todos = ["app", "components", "hooks", "lib", "contexts", "providers"].flatMap((d) => archivos(join(RAIZ, d)))

  it("scans a real tree (the sweep is not vacuous) and finds the allowed users", () => {
    expect(todos.length).toBeGreaterThan(300)
    const usuarios = todos.filter((f) => SIMBOLOS.test(readFileSync(f, "utf8"))).map(rel).sort()
    expect(usuarios).toEqual([...PERMITIDOS].sort())
  })

  it("no export, v1, webhook, conteo or catalog code mentions the fallback", () => {
    const sensibles = todos
      .map(rel)
      .filter((f) => /(export|\/v1\/|webhook|conteo|catalogo|etiqueta|inventario-eventos)/i.test(f))
    expect(sensibles.length).toBeGreaterThan(10)
    expect(sensibles.filter((f) => SIMBOLOS.test(readFileSync(join(RAIZ, f), "utf8")))).toEqual([])
  })

  it("the detector recognizes each symbol", () => {
    for (const s of ["adjuntarFotoDeRespaldo(", "imagenRespaldoDe(", "{ fotoDeRespaldo }"]) expect(SIMBOLOS.test(s)).toBe(true)
    expect(SIMBOLOS.test("imagenRespaldo")).toBe(false)
  })
})
