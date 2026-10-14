import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, createGetRequest, parseResponse } from "./helpers"

import { GET } from "@/app/api/inventario/route"

// The list SELECT gains `grupo_id, atributos` (migration 355) in its own step. While
// the migration is not applied the database answers with a missing-column error, and
// the list must fall back to today's exact SELECT instead of failing (G1). The fake is
// SELECT-aware: it errors ONLY when the select string names a column that does not
// exist, returns only the columns that were asked for, and records every attempt with
// the filters it carried. It holds two organizations and a soft-deleted row, so a query
// that forgets its organization or soft-delete filter returns the wrong rows.

// The list select exactly as it was on origin/main before the variant columns.
const SELECT_ACTUAL =
  "id, codigo, nombre, descripcion, categoria, tipo_dispositivo, stock, stock_reservado, precio_compra, precio_venta, proveedor, proveedor_id, imagen_url, imagen_path, stock_minimo, stock_maximo, punto_reorden, ubicacion, barcode, trackea_lotes, trackea_series, dias_alerta_vencimiento, dias_garantia_default, tiene_variantes, es_kit, tipo_kit, deleted_at, deleted_by, created_at, proveedores:proveedor_id(id, nombre)"
const SELECT_CON_GRUPO = `${SELECT_ACTUAL}, grupo_id, atributos`
const LISTA = "http://localhost:3000/api/inventario"

const base = {
  codigo: "FX",
  descripcion: null,
  categoria: "Fundas",
  tipo_dispositivo: "CELULAR",
  stock: 10,
  stock_reservado: 0,
  precio_compra: 300,
  precio_venta: 900,
  proveedor: null,
  proveedor_id: null,
  tiene_variantes: false,
  deleted_at: null,
  deleted_by: null,
  organization_id: "org-1",
}
const azul = {
  ...base,
  id: "inv-azul",
  nombre: "Funda X - Azul / M",
  // Own photo: these tests are about the list SELECT; the sibling-photo lookup (a grouped row
  // WITHOUT a photo) has its own file, inventario-fotos-respaldo.test.ts.
  imagen_url: "https://f/azul.jpg",
  grupo_id: "g-1",
  atributos: [
    { opcion: "Color", valor: "Azul" },
    { opcion: "Talle", valor: "M" },
  ],
}
const suelta = { ...base, id: "inv-suelta", nombre: "Pantalla", grupo_id: null, atributos: null }
const archivada = { ...base, id: "inv-archivada", nombre: "Vieja", grupo_id: null, atributos: null, deleted_at: "2026-02-01T00:00:00Z" }
const ajena = { ...base, id: "inv-ajena", nombre: "De otra org", organization_id: "org-2", grupo_id: null, atributos: null }
const FILAS = [ajena, azul, archivada, suelta]

// Realistic errors: a bare code would lie about 42P01/PGRST200 (isMissingColumnError
// matches those by message text).
const AUSENTE: [string, string][] = [
  ["42703", "column inventario.grupo_id does not exist"],
  ["PGRST204", "Could not find the 'grupo_id' column of 'inventario' in the schema cache"],
  ["42P01", 'relation "inventario_grupos" does not exist'],
  ["PGRST200", "Could not find a relationship between 'inventario' and 'inventario_grupos' in the schema cache"],
]

interface Intento {
  select: string
  conteo: string | null
  modo: "fts" | "ilike"
  eq: [string, unknown][]
  is: [string, unknown][]
  or: string[]
}

function fakeLista(opts: { m1Aplicada: boolean; error?: { code: string; message: string }; ftsVacio?: boolean }) {
  const intentos: Intento[] = []
  const error = opts.error ?? { code: "42703", message: AUSENTE[0][1] }

  vi.mocked(supabaseAdmin.from).mockImplementation(((tabla: string) => {
    if (tabla !== "inventario") throw new Error(`unexpected table ${tabla}`)
    const intento: Intento = { select: "", conteo: null, modo: "ilike", eq: [], is: [], or: [] }
    const api: any = {
      select: (columnas: string, o?: { count?: string }) => {
        intento.select = columnas
        intento.conteo = o?.count ?? null
        intentos.push(intento)
        return api
      },
      eq: (col: string, val: unknown) => (intento.eq.push([col, val]), api),
      is: (col: string, val: unknown) => (intento.is.push([col, val]), api),
      or: (filtro: string) => (intento.or.push(filtro), api),
      textSearch: () => ((intento.modo = "fts"), api),
      order: () => api,
      range: () => api,
      then: (resolve: any, reject?: any) => {
        const pide = (columna: string) => new RegExp(`\\b${columna}\\b`).test(intento.select)
        let resultado: Record<string, unknown>
        if (pide("grupo_id") && !opts.m1Aplicada) {
          resultado = { data: null, error, count: null }
        } else {
          const coinciden = intento.modo === "fts" && opts.ftsVacio
            ? []
            : FILAS.filter(
                (f) =>
                  intento.eq.every(([col, val]) => (f as Record<string, unknown>)[col] === val) &&
                  intento.is.every(([col, val]) => ((f as Record<string, unknown>)[col] ?? null) === val)
              )
          // Only the columns that were asked for come back (the embed is not modeled).
          const pedidas = intento.select.replace(/\([^)]*\)/g, "").split(",").map((c) => c.trim())
          const datos = coinciden.map((f) =>
            Object.fromEntries(Object.entries(f).filter(([k]) => pedidas.includes(k)))
          )
          resultado = { data: datos, error: null, count: intento.conteo === "exact" ? coinciden.length : null }
        }
        return Promise.resolve(resultado).then(resolve, reject)
      },
    }
    return api
  }) as any)

  return { intentos }
}

// Every attempt of the list carries the caller's organization and hides archived rows.
const FILTROS = { eq: [["organization_id", "org-1"]], is: [["deleted_at", null]] }
const filtros = (i: Intento) => ({ eq: i.eq, is: i.is })

describe("GET /api/inventario: the M1 columns are optional (G1)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
  })

  it.each(AUSENTE)("answers 200 with plain rows when the database says %s", async (code, message) => {
    const { intentos } = fakeLista({ m1Aplicada: false, error: { code, message } })

    const { status, body } = await parseResponse(await GET(createGetRequest(LISTA)))

    expect(status).toBe(200)
    // The caller's active rows only: not org-2's, not the archived one.
    expect(body.data.map((r: any) => r.id)).toEqual(["inv-azul", "inv-suelta"])
    expect(body.total).toBe(2)
    for (const fila of body.data) {
      expect(fila).not.toHaveProperty("grupoId")
      expect(fila).not.toHaveProperty("atributos")
      expect(fila).not.toHaveProperty("etiqueta")
    }
    // Exactly two attempts: the M1 select, then today's select, byte for byte.
    expect(intentos.map((i) => i.select)).toEqual([SELECT_CON_GRUPO, SELECT_ACTUAL])
    for (const intento of intentos) {
      expect(filtros(intento)).toEqual(FILTROS)
      expect(intento.conteo).toBe("exact")
    }
  })

  it("the ILIKE retry reuses the downgraded select: no third M1 attempt", async () => {
    const { intentos } = fakeLista({ m1Aplicada: false, ftsVacio: true })

    const { status, body } = await parseResponse(await GET(createGetRequest(`${LISTA}?search=panta`)))

    expect(status).toBe(200)
    expect(body.data.map((r: any) => r.id)).toEqual(["inv-azul", "inv-suelta"])
    expect(body.total).toBe(2)
    expect(intentos.map((i) => [i.modo, i.select])).toEqual([
      ["fts", SELECT_CON_GRUPO], // M1 attempt, fails
      ["fts", SELECT_ACTUAL], // downgraded, finds nothing
      ["ilike", SELECT_ACTUAL], // retry stays downgraded
    ])
    for (const intento of intentos) expect(filtros(intento)).toEqual(FILTROS)
    expect(intentos[2].or).toHaveLength(1)
    expect(intentos[2].or[0]).toContain("nombre.ilike.%panta%")
  })

  it("with M1 applied the rows carry the variant keys and nothing is retried", async () => {
    const { intentos } = fakeLista({ m1Aplicada: true })

    const { status, body } = await parseResponse(await GET(createGetRequest(LISTA)))

    expect(status).toBe(200)
    expect(intentos.map((i) => i.select)).toEqual([SELECT_CON_GRUPO])
    expect(filtros(intentos[0])).toEqual(FILTROS)
    expect(body.total).toBe(2)
    expect(body.data.map((r: any) => r.id)).toEqual(["inv-azul", "inv-suelta"])
    expect(body.data[0]).toMatchObject({
      id: "inv-azul",
      grupoId: "g-1",
      atributos: azul.atributos,
      etiqueta: "Azul / M",
    })
    expect(body.data[1]).toMatchObject({ id: "inv-suelta", grupoId: null, atributos: null, etiqueta: null })
  })

  it("with M1 applied the ILIKE retry keeps the M1 columns", async () => {
    const { intentos } = fakeLista({ m1Aplicada: true, ftsVacio: true })

    const { body } = await parseResponse(await GET(createGetRequest(`${LISTA}?search=panta`)))

    expect(body.data[0].grupoId).toBe("g-1")
    expect(intentos.map((i) => [i.modo, i.select])).toEqual([
      ["fts", SELECT_CON_GRUPO],
      ["ilike", SELECT_CON_GRUPO],
    ])
    for (const intento of intentos) expect(filtros(intento)).toEqual(FILTROS)
  })

  it("includeArchived drops only the soft-delete filter, never the organization one", async () => {
    const { intentos } = fakeLista({ m1Aplicada: false })

    const { body } = await parseResponse(await GET(createGetRequest(`${LISTA}?includeArchived=true`)))

    expect(body.data.map((r: any) => r.id)).toEqual(["inv-azul", "inv-archivada", "inv-suelta"])
    expect(body.total).toBe(3)
    for (const intento of intentos) expect(filtros(intento)).toEqual({ eq: FILTROS.eq, is: [] })
  })

  it("an error that is not a missing column is a 500 and is not retried", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { intentos } = fakeLista({
      m1Aplicada: false,
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    })

    const { status, body } = await parseResponse(await GET(createGetRequest(LISTA)))

    expect(status).toBe(500)
    expect(body.error).toBe("Error al obtener inventario")
    expect(intentos).toHaveLength(1)
  })
})
