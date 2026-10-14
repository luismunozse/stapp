import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, createGetRequest, parseResponse } from "./helpers"

import { GET } from "@/app/api/inventario/check-duplicate/route"

// check-duplicate is a soft "is this a duplicate?" signal. Variants of one group are siblings,
// not duplicates (VI-2): the siblings of the item being edited are excluded (`excludeGrupoId`)
// and another group with several children yields ONE match. The grupo_id column rides in its
// own select step that falls back to today's exact select while migration 355 is missing (G1).
// The fake is SELECT-aware (it errors only when the select names grupo_id and the migration is
// not applied, and returns only the asked-for columns), honors the organization / deleted_at /
// neq filters, and records every attempt.

const SELECT_ACTUAL =
  "id, codigo, nombre, categoria, tipo_dispositivo, stock, precio_compra, precio_venta, proveedor_id, proveedores:proveedor_id(id, nombre)"
const SELECT_CON_GRUPO = `${SELECT_ACTUAL}, grupo_id`

const fila = (id: string, nombre: string, extra: Record<string, unknown> = {}) => ({
  id,
  organization_id: "org-1",
  codigo: `C-${id}`,
  nombre,
  categoria: "Fundas",
  tipo_dispositivo: "CELULAR",
  stock: 3,
  precio_compra: 100,
  precio_venta: 200,
  proveedor_id: null,
  proveedores: null,
  deleted_at: null,
  grupo_id: null as string | null,
  ...extra,
})

// Group g-x: the item being edited (Azul) and its sibling (Rojo).
// Group g-pro: four children of another product whose name also matches.
const ALMACEN = [
  fila("x-azul", "Funda X - Azul", { grupo_id: "g-x" }),
  fila("x-rojo", "Funda X - Rojo", { grupo_id: "g-x" }),
  fila("pro-negro", "Funda X Pro - Negro", { grupo_id: "g-pro" }),
  fila("pro-azul", "Funda X Pro - Azul", { grupo_id: "g-pro" }),
  fila("pro-verde", "Funda X Pro - Verde", { grupo_id: "g-pro" }),
  fila("pro-rojo", "Funda X Pro - Rojo", { grupo_id: "g-pro" }),
  fila("suelta-1", "Funda X", { codigo: "FX-1" }),
  fila("suelta-2", "Funda X", { codigo: "FX-2" }),
  fila("ajena", "Funda X", { organization_id: "org-2" }),
  fila("archivada", "Funda X", { deleted_at: "2026-01-01T00:00:00Z" }),
]

const AUSENTE: [string, string][] = [
  ["42703", "column inventario.grupo_id does not exist"],
  ["PGRST200", "Could not find a relationship between 'inventario' and 'inventario_grupos' in the schema cache"],
]

interface Intento {
  select: string
  eq: [string, unknown][]
  neq: [string, unknown][]
  is: [string, unknown][]
  or: string[]
  limit: number | null
}

function fake(opts: { m1Aplicada: boolean; error?: { code: string; message: string }; filas?: Record<string, any>[] }) {
  const intentos: Intento[] = []
  const error = opts.error ?? { code: "42703", message: AUSENTE[0][1] }
  vi.mocked(supabaseAdmin.from).mockImplementation(((tabla: string) => {
    if (tabla !== "inventario") throw new Error(`unexpected table ${tabla}`)
    const intento: Intento = { select: "", eq: [], neq: [], is: [], or: [], limit: null }
    const api: any = {
      select: (c: string) => ((intento.select = c), intentos.push(intento), api),
      eq: (c: string, v: unknown) => (intento.eq.push([c, v]), api),
      neq: (c: string, v: unknown) => (intento.neq.push([c, v]), api),
      is: (c: string, v: unknown) => (intento.is.push([c, v]), api),
      or: (f: string) => (intento.or.push(f), api),
      limit: (n: number) => ((intento.limit = n), api),
      then: (resolve: any, reject?: any) => {
        if (/\bgrupo_id\b/.test(intento.select) && !opts.m1Aplicada) {
          return Promise.resolve({ data: null, error }).then(resolve, reject)
        }
        const pedidas = intento.select.replace(/\([^)]*\)/g, "").split(",").map((c) => c.trim())
        const datos = (opts.filas ?? ALMACEN)
          .filter(
            (f) =>
              intento.eq.every(([c, v]) => f[c] === v) &&
              intento.neq.every(([c, v]) => f[c] !== v) &&
              intento.is.every(([c, v]) => (f[c] ?? null) === v) &&
              intento.or.every((filtro) => {
                // Only the exact filter the route may build: grupo_id.is.null,grupo_id.neq.<id>
                const m = /^grupo_id.is.null,grupo_id.neq.([A-Za-z0-9_-]+)$/.exec(filtro)
                if (!m) throw new Error(`unexpected or() filter: ${filtro}`)
                return f.grupo_id == null || f.grupo_id !== m[1]
              })
          )
          .slice(0, intento.limit ?? Infinity)
          .map((f) => ({ ...Object.fromEntries(Object.entries(f).filter(([k]) => pedidas.includes(k))), proveedores: f.proveedores }))
        return Promise.resolve({ data: datos, error: null }).then(resolve, reject)
      },
    }
    return api
  }) as any)
  return { intentos }
}

const BASE = "http://localhost:3000/api/inventario/check-duplicate"
const consultar = async (query: string) => parseResponse(await GET(createGetRequest(`${BASE}?${query}`)))
const ids = (matches: { id: string }[]) => matches.map((m) => m.id).sort()

describe("GET /api/inventario/check-duplicate: variant groups", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
  })

  it("does not report the siblings of the item being edited", async () => {
    fake({ m1Aplicada: true })

    const { status, body } = await consultar("nombre=Funda X&excludeId=x-azul&excludeGrupoId=g-x")

    expect(status).toBe(200)
    expect(ids(body.matches)).not.toContain("x-rojo")
    expect(ids(body.matches)).not.toContain("x-azul")
  })

  it("reports the sibling when excludeGrupoId is not sent (the parameter is what excludes it)", async () => {
    fake({ m1Aplicada: true })
    const { body } = await consultar("nombre=Funda X&excludeId=x-azul")
    expect(ids(body.matches)).toContain("x-rojo")
  })

  it("returns ONE match for another group with four children, and keeps standalone matches", async () => {
    fake({ m1Aplicada: true })

    const { body } = await consultar("nombre=Funda X Pro&excludeId=x-azul&excludeGrupoId=g-x")

    const delGrupoPro = body.matches.filter((m: any) => m.id.startsWith("pro-"))
    expect(delGrupoPro).toHaveLength(1)
    // Equal scores: the lowest id represents the group, whatever order the database answers in.
    expect(delGrupoPro[0].id).toBe("pro-azul")
  })

  it("picks the best-scoring child to represent its group", async () => {
    const filas = [
      fila("g-peor", "Funda X Pro Max Plus Edicion", { grupo_id: "g-1" }),
      fila("g-mejor", "Funda X Pro", { grupo_id: "g-1" }),
    ]
    fake({ m1Aplicada: true, filas })
    const { body } = await consultar("nombre=Funda X Pro")
    expect(ids(body.matches)).toEqual(["g-mejor"])
  })

  it("does not let one group fill the eight slots: ten groups of four children give eight matches from eight groups", async () => {
    const filas = Array.from({ length: 10 }, (_, g) =>
      Array.from({ length: 4 }, (_, c) => fila(`g${g}-c${c}`, `Funda X Pro ${g} - v${c}`, { grupo_id: `grupo-${g}` }))
    ).flat()
    fake({ m1Aplicada: true, filas })

    const { body } = await consultar("nombre=Funda X Pro")

    expect(body.matches).toHaveLength(8)
    expect(new Set(body.matches.map((m: any) => m.id.split("-")[0])).size).toBe(8)
  })

  it("never collapses standalone products", async () => {
    fake({ m1Aplicada: true })
    const { body } = await consultar("nombre=Funda X")
    // Two standalone products with the same name are two matches (the other org and the archived one are out).
    expect(ids(body.matches).filter((id) => id.startsWith("suelta"))).toEqual(["suelta-1", "suelta-2"])
  })

  it("keeps today's match shape (no variant key)", async () => {
    fake({ m1Aplicada: true })
    const { body } = await consultar("nombre=Funda X&excludeId=x-azul&excludeGrupoId=g-x")
    const suelta = body.matches.find((m: any) => m.id === "suelta-1")
    expect(Object.keys(suelta).sort()).toEqual(
      ["categoria", "codigo", "id", "nombre", "precioCompra", "precioVenta", "proveedor", "score", "stock", "tipoDispositivo"].sort()
    )
  })

  it.each(AUSENTE)("answers 200 with today's select and no collapse when the database says %s (G1)", async (code, message) => {
    const { intentos } = fake({ m1Aplicada: false, error: { code, message } })

    const { status, body } = await consultar("nombre=Funda X Pro&excludeGrupoId=g-x")

    expect(status).toBe(200)
    expect(intentos.map((i) => i.select)).toEqual([SELECT_CON_GRUPO, SELECT_ACTUAL])
    // Without grupo_id there is nothing to collapse: the four children of the other group all match.
    expect(body.matches.filter((m: any) => m.id.startsWith("pro-"))).toHaveLength(4)
  })

  it("scopes the query to the organization and to active items, in the grouped step too", async () => {
    const { intentos } = fake({ m1Aplicada: true })
    await consultar("nombre=Funda X&excludeId=x-azul")
    expect(intentos).toHaveLength(1)
    expect(intentos[0].eq).toContainEqual(["organization_id", "org-1"])
    expect(intentos[0].is).toContainEqual(["deleted_at", null])
    expect(intentos[0].neq).toContainEqual(["id", "x-azul"])
  })
  describe("sibling exclusion runs in the database (inside the 500-row window)", () => {
    it("sends the exact filter that keeps rows without a group", async () => {
      const { intentos } = fake({ m1Aplicada: true })
      const { body } = await consultar("nombre=Funda X&excludeGrupoId=c0123456789abcdef01234567")
      expect(intentos).toHaveLength(1)
      expect(intentos[0].or).toEqual(["grupo_id.is.null,grupo_id.neq.c0123456789abcdef01234567"])
      // Standalone matches (NULL group) survive the filter.
      expect(ids(body.matches)).toEqual(expect.arrayContaining(["suelta-1", "suelta-2"]))
    })

    it("does not let siblings take slots of the 500-row window and hide a real duplicate", async () => {
      const grupo = "c0123456789abcdef01234567"
      const hermanos = Array.from({ length: 500 }, (_, i) => fila(`h${i}`, "Funda X", { grupo_id: grupo }))
      const real = fila("real", "Funda X", { codigo: "REAL" })
      fake({ m1Aplicada: true, filas: [...hermanos, real] })
      const { body } = await consultar(`nombre=Funda X&excludeGrupoId=${grupo}`)
      expect(ids(body.matches)).toEqual(["real"])
    })

    it("does not apply the filter on the fallback step (the column is missing)", async () => {
      const { intentos } = fake({ m1Aplicada: false })
      const { status } = await consultar("nombre=Funda X&excludeGrupoId=c0123456789abcdef01234567")
      expect(status).toBe(200)
      expect(intentos.map((i) => i.select)).toEqual([SELECT_CON_GRUPO, SELECT_ACTUAL])
      expect(intentos[1].or).toEqual([])
    })

    it.each(["x,grupo_id.neq.y", "a)b", "c0123456789abcdef01234567,id.eq.1", "a b", "a.b", "x".repeat(101)])(
      "ignores a malformed excludeGrupoId (%s): it never reaches any filter",
      async (malo) => {
        const { intentos } = fake({ m1Aplicada: true })
        const { status } = await consultar(`nombre=Funda X&excludeGrupoId=${encodeURIComponent(malo)}`)
        expect(status).toBe(200)
        expect(intentos.every((i) => i.or.length === 0)).toBe(true)
        expect(JSON.stringify(intentos)).not.toContain(malo)
      }
    )
  })

})
