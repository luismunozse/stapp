import { describe, it, expect, vi, beforeEach } from "vitest"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, createGetRequest, parseResponse } from "./helpers"
import { resetCacheResolucionVenta } from "@/lib/sucursal"

import { GET } from "@/app/api/inventario/search/route"

// POS search: variants carry grupoId / etiqueta / atributos / grupoNombre (PV-2), a `grupoId`
// query returns the members of one group, and both branches (aggregate stock and the
// sucursal-scoped deposito join) read the variant columns in their OWN select step that falls
// back to today's exact select while migration 355 is missing (G1).
//
// The inventario fake is SELECT-aware and filter-honoring (G1, G7): it errors ONLY when the
// select string names grupo_id and the migration is not applied, returns only the columns that
// were asked for, honors eq/is/gt/or/limit and the `!inner` deposito scope (a row with no stock
// record in the selling deposito is NOT returned), and records every attempt.

const SELECT_VERTODAS_ACTUAL =
  "id, codigo, nombre, stock, stock_reservado, precio_venta, precio_compra, trackea_series, dias_garantia_default"
const SELECT_DEPOSITO_ACTUAL =
  "id, codigo, nombre, precio_venta, precio_compra, trackea_series, dias_garantia_default, inventario_depositos!inner(stock, stock_reservado, deposito_id)"
const COLUMNAS_VARIANTE = "grupo_id, atributos, grupo:inventario_grupos(nombre)"
const SELECT_VERTODAS_CON_GRUPO = `${SELECT_VERTODAS_ACTUAL}, ${COLUMNAS_VARIANTE}`
const SELECT_DEPOSITO_CON_GRUPO = `${SELECT_DEPOSITO_ACTUAL}, ${COLUMNAS_VARIANTE}`

const GRUPOS: Record<string, string> = { "g-1": "Funda X", "g-2": "Funda Y" }

const fila = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  organization_id: "org-1",
  codigo: `C-${id}`,
  nombre: id,
  stock: 5,
  stock_reservado: 0,
  precio_venta: 100,
  precio_compra: 60,
  trackea_series: false,
  dias_garantia_default: null,
  deleted_at: null,
  grupo_id: null,
  atributos: null,
  depositos: [{ deposito_id: "dep-1", stock: 5, stock_reservado: 1 }],
  ...extra,
})
const azul = fila("azul", {
  nombre: "Funda X - Azul / M",
  grupo_id: "g-1",
  atributos: [
    { opcion: "Color", valor: "Azul" },
    { opcion: "Talle", valor: "M" },
  ],
})
const rojo = fila("rojo", {
  nombre: "Funda X - Rojo / M",
  grupo_id: "g-1",
  atributos: [
    { opcion: "Color", valor: "Rojo" },
    { opcion: "Talle", valor: "M" },
  ],
  stock: 0,
  depositos: [], // no stock record in the selling deposito
})
const verde = fila("verde", {
  nombre: "Funda X - Verde / M",
  grupo_id: "g-1",
  atributos: [
    { opcion: "Color", valor: "Verde" },
    { opcion: "Talle", valor: "M" },
  ],
  stock: 0,
  depositos: [{ deposito_id: "dep-1", stock: 0, stock_reservado: 0 }],
})
const ajeno = fila("ajeno", { nombre: "Funda X - Rojo / M", organization_id: "org-2", grupo_id: "g-1", atributos: [{ opcion: "Color", valor: "Rojo" }] })
const otroGrupo = fila("otro-grupo", { nombre: "Funda Y - Negro", grupo_id: "g-2", atributos: [{ opcion: "Color", valor: "Negro" }] })
const suelto = fila("suelto", { nombre: "Pantalla" })
const archivado = fila("archivado", { nombre: "Funda X - Viejo", grupo_id: "g-1", atributos: [{ opcion: "Color", valor: "Viejo" }], deleted_at: "2026-01-01T00:00:00Z" })
const TODAS = [ajeno, azul, otroGrupo, rojo, suelto, verde, archivado]

const AUSENTE: [string, string][] = [
  ["42703", "column inventario.grupo_id does not exist"],
  ["PGRST200", "Could not find a relationship between 'inventario' and 'inventario_grupos' in the schema cache"],
  ["42P01", 'relation "inventario_grupos" does not exist'],
]

interface Intento {
  select: string
  eq: [string, unknown][]
  is: [string, unknown][]
  gt: [string, unknown][]
  or: string[]
  limit: number | null
}

function separarColumnas(select: string): string[] {
  const salida: string[] = []
  let profundidad = 0
  let actual = ""
  for (const ch of select) {
    if (ch === "(") profundidad++
    if (ch === ")") profundidad--
    if (ch === "," && profundidad === 0) {
      salida.push(actual.trim())
      actual = ""
    } else actual += ch
  }
  salida.push(actual.trim())
  return salida
}

function fakeInventario(opts: { m1Aplicada: boolean; error?: { code: string; message: string }; filas?: Record<string, any>[] }) {
  const intentos: Intento[] = []
  const error = opts.error ?? { code: "42703", message: AUSENTE[0][1] }
  const filas: Record<string, any>[] = opts.filas ?? TODAS

  const api = () => {
    const intento: Intento = { select: "", eq: [], is: [], gt: [], or: [], limit: null }
    const q: any = {
      select: (columnas: string) => ((intento.select = columnas), intentos.push(intento), q),
      eq: (c: string, v: unknown) => (intento.eq.push([c, v]), q),
      is: (c: string, v: unknown) => (intento.is.push([c, v]), q),
      gt: (c: string, v: unknown) => (intento.gt.push([c, v]), q),
      or: (f: string) => (intento.or.push(f), q),
      order: () => q,
      limit: (n: number) => ((intento.limit = n), q),
      then: (resolve: any, reject?: any) => {
        if (/\bgrupo_id\b/.test(intento.select) && !opts.m1Aplicada) {
          return Promise.resolve({ data: null, error }).then(resolve, reject)
        }
        const columnas = separarColumnas(intento.select)
        const conDeposito = columnas.some((c) => c.startsWith("inventario_depositos!inner"))
        const depositoPedido = intento.eq.find(([c]) => c === "inventario_depositos.deposito_id")?.[1]
        let coinciden = filas.filter((f) => {
          for (const [c, v] of intento.eq) {
            if (c === "inventario_depositos.deposito_id") continue
            if (f[c] !== v) return false
          }
          if (!intento.is.every(([c, v]) => (f[c] ?? null) === v)) return false
          for (const [c, v] of intento.gt) {
            const valor = c === "inventario_depositos.stock" ? f.depositos.find((d: any) => d.deposito_id === depositoPedido)?.stock : f[c]
            if (!(valor > (v as number))) return false
          }
          for (const filtro of intento.or) {
            const ors = filtro.split(",").map((p) => /^(\w+)\.ilike\.%(.*)%$/.exec(p)!)
            if (!ors.some(([, col, term]) => String(f[col]).toLowerCase().includes(term.toLowerCase()))) return false
          }
          if (conDeposito && !f.depositos.some((d: any) => d.deposito_id === depositoPedido)) return false
          return true
        })
        if (intento.limit !== null) coinciden = coinciden.slice(0, intento.limit)
        const datos = coinciden.map((f) => {
          const salida: Record<string, unknown> = {}
          for (const c of columnas) {
            if (c.startsWith("inventario_depositos!inner")) {
              salida.inventario_depositos = f.depositos.filter((d: any) => d.deposito_id === depositoPedido)
            } else if (c.startsWith("grupo:inventario_grupos")) {
              salida.grupo = f.grupo_id ? { nombre: GRUPOS[f.grupo_id] } : null
            } else salida[c] = f[c]
          }
          return salida
        })
        return Promise.resolve({ data: datos, error: null }).then(resolve, reject)
      },
    }
    return q
  }

  const sucursales: any = {}
  for (const m of ["select", "eq", "is"]) sucursales[m] = vi.fn().mockReturnValue(sucursales)
  sucursales.single = vi.fn().mockResolvedValue({ data: { id: "suc-1", nombre: "Casa Central" }, error: null })
  const depositos: any = {}
  for (const m of ["select", "eq", "is"]) depositos[m] = vi.fn().mockReturnValue(depositos)
  depositos.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "dep-1" }, error: null })

  vi.mocked(supabaseAdmin.from).mockImplementation(((tabla: string) => {
    if (tabla === "inventario") return api()
    if (tabla === "sucursales") return sucursales
    if (tabla === "depositos") return depositos
    throw new Error(`unexpected table ${tabla}`)
  }) as any)
  return { intentos }
}

const BUSCAR = "http://localhost:3000/api/inventario/search"
const buscar = async (query: string) => parseResponse(await GET(createGetRequest(`${BUSCAR}?${query}`)))
const ids = (body: any[]) => body.map((r) => r.id)

describe("GET /api/inventario/search: variant fields and the grupoId filter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetCacheResolucionVenta()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn(() => undefined), set: vi.fn() } as any)
  })

  describe.each([
    ["aggregate stock (ver todas)", "", SELECT_VERTODAS_ACTUAL, SELECT_VERTODAS_CON_GRUPO],
    ["sucursal-scoped deposito join", "&scope=venta", SELECT_DEPOSITO_ACTUAL, SELECT_DEPOSITO_CON_GRUPO],
  ])("%s", (_rama, scope, selectActual, selectConGrupo) => {
    it("adds grupoId, etiqueta, atributos and grupoNombre to a variant and nothing to a standalone row", async () => {
      fakeInventario({ m1Aplicada: true })

      const { status, body } = await buscar(`q=&includeZeroStock=true${scope}`)

      expect(status).toBe(200)
      const porId = Object.fromEntries(body.map((r: any) => [r.id, r]))
      expect(porId.azul).toMatchObject({
        grupoId: "g-1",
        etiqueta: "Azul / M",
        atributos: [
          { opcion: "Color", valor: "Azul" },
          { opcion: "Talle", valor: "M" },
        ],
        grupoNombre: "Funda X",
      })
      // A standalone row has exactly today's keys: no variant key at all.
      expect(Object.keys(porId.suelto).sort()).toEqual(
        ["codigo", "diasGarantiaDefault", "id", "nombre", "precioCompra", "precioVenta", "stock", "stockReservado", "trackeaSeries"].sort()
      )
      expect(porId.suelto).not.toHaveProperty("grupoId")
      expect(selectConGrupo).toContain(selectActual)
    })

    it("returns the members of the group for grupoId and nothing from another group or organization", async () => {
      const { intentos } = fakeInventario({ m1Aplicada: true })

      const { status, body } = await buscar(`q=&grupoId=g-1&includeZeroStock=true${scope}`)

      expect(status).toBe(200)
      // Active members of g-1 of THIS organization; the archived one, the other group, the other org and the standalone row are out.
      const esperados = scope ? ["azul", "verde"] : ["azul", "rojo", "verde"]
      expect(ids(body).sort()).toEqual(esperados)
      expect(intentos).toHaveLength(1)
      expect(intentos[0].eq).toContainEqual(["grupo_id", "g-1"])
      expect(intentos[0].eq).toContainEqual(["organization_id", "org-1"])
    })

    it("matches the text search against the child names", async () => {
      fakeInventario({ m1Aplicada: true })
      const { body } = await buscar(`q=funda azul&includeZeroStock=true${scope}`)
      expect(ids(body)).toEqual(["azul"])
      expect(body[0].etiqueta).toBe("Azul / M")
    })

    it.each(AUSENTE)("falls back to today's exact select when the database says %s", async (code, message) => {
      const { intentos } = fakeInventario({ m1Aplicada: false, error: { code, message } })

      const { status, body } = await buscar(`q=&includeZeroStock=true${scope}`)

      expect(status).toBe(200)
      // Which select each call carried, not just how many (G10).
      expect(intentos.map((i) => i.select)).toEqual([selectConGrupo, selectActual])
      // Plain rows: the old SELECT returns no variant key.
      expect(ids(body).sort()).toEqual(["azul", "otro-grupo", "rojo", "suelto", "verde"].filter((id) => !scope || id !== "rojo").sort())
      for (const r of body) {
        expect(r).not.toHaveProperty("grupoId")
        expect(r).not.toHaveProperty("grupoNombre")
      }
    })

    it("answers an empty list for a grupoId while the migration is missing (no group can exist)", async () => {
      const { intentos } = fakeInventario({ m1Aplicada: false })

      const { status, body } = await buscar(`q=&grupoId=g-1&includeZeroStock=true${scope}`)

      expect(status).toBe(200)
      expect(body).toEqual([])
      // The old select was never asked to filter a column it does not have.
      expect(intentos.filter((i) => i.eq.some(([c]) => c === "grupo_id" && !/\bgrupo_id\b/.test(i.select)))).toEqual([])
    })

    it("does not downgrade on an unrelated database error", async () => {
      const { intentos } = fakeInventario({
        m1Aplicada: false,
        error: { code: "57014", message: "canceling statement due to statement timeout" },
      })
      // grupo_id is requested and the fake errors, but the error is not a missing column.
      const registro = vi.spyOn(console, "error").mockImplementation(() => {})

      const { status } = await buscar(`q=&includeZeroStock=true${scope}`)
      registro.mockRestore()

      expect(status).toBe(500)
      expect(intentos).toHaveLength(1)
    })
  })

  it("keeps the deposito scope: a sibling with no stock record in the selling deposito is not returned", async () => {
    fakeInventario({ m1Aplicada: true })
    const { body } = await buscar("q=&grupoId=g-1&includeZeroStock=true&scope=venta")
    expect(ids(body)).not.toContain("rojo")
    // And the stock is the deposito's, not the aggregate.
    expect(body.find((r: any) => r.id === "azul")).toMatchObject({ stock: 5, stockReservado: 1 })
  })
})
