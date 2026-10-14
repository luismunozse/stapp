import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  parseResponse,
} from "./helpers"

import { GET } from "@/app/api/inventario/route"

// The list SELECT gains `grupo_id, atributos` (migration 355) in its own step. While
// the migration is not applied the database answers with a missing-column error, and
// the list must fall back to today's exact SELECT instead of failing (G1). The fake is
// SELECT-aware: it errors ONLY when the select string names a column that does not
// exist, returns a column only when it was asked for, and records every call.

const COLUMNAS_M1 = ", grupo_id, atributos"
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
}
const azul = {
  ...base,
  id: "inv-azul",
  nombre: "Funda X - Azul / M",
  grupo_id: "g-1",
  atributos: [
    { opcion: "Color", valor: "Azul" },
    { opcion: "Talle", valor: "M" },
  ],
}
const suelta = { ...base, id: "inv-suelta", nombre: "Pantalla", grupo_id: null, atributos: null }

// Realistic errors: a bare code would lie about 42P01/PGRST200 (isMissingColumnError
// matches those by message text).
const AUSENTE: [string, string][] = [
  ["42703", "column inventario.grupo_id does not exist"],
  ["PGRST204", "Could not find the 'grupo_id' column of 'inventario' in the schema cache"],
  ["42P01", 'relation "inventario_grupos" does not exist'],
  ["PGRST200", "Could not find a relationship between 'inventario' and 'inventario_grupos' in the schema cache"],
]

function fakeLista(opts: { m1Aplicada: boolean; error?: { code: string; message: string }; ftsVacio?: boolean }) {
  const chain = createChainMock()
  const llamadas: { select: string; modo: "fts" | "ilike" }[] = []
  let actual = { select: "", modo: "ilike" as "fts" | "ilike" }

  chain.select.mockImplementation((columnas: string) => {
    actual = { select: columnas, modo: "ilike" }
    llamadas.push(actual)
    return chain
  })
  chain.textSearch.mockImplementation(() => {
    actual.modo = "fts"
    return chain
  })
  chain.then = (resolve: any, reject?: any) => {
    const { select, modo } = actual
    const pide = (columna: string) => new RegExp(`\\b${columna}\\b`).test(select)
    let resultado: Record<string, unknown>
    if (pide("grupo_id") && !opts.m1Aplicada) {
      resultado = { data: null, error: opts.error ?? { code: "42703", message: AUSENTE[0][1] }, count: null }
    } else if (modo === "fts" && opts.ftsVacio) {
      resultado = { data: [], error: null, count: 0 }
    } else {
      const filas = [azul, suelta].map((fila) => {
        const copia: Record<string, unknown> = { ...fila }
        if (!pide("grupo_id")) delete copia.grupo_id
        if (!pide("atributos")) delete copia.atributos
        return copia
      })
      resultado = { data: filas, error: null, count: filas.length }
    }
    return Promise.resolve(resultado).then(resolve, reject)
  }
  mockSupabaseFrom({ inventario: chain })
  return { llamadas }
}

describe("GET /api/inventario: the M1 columns are optional (G1)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
  })

  it.each(AUSENTE)("answers 200 with plain rows when the database says %s", async (code, message) => {
    const { llamadas } = fakeLista({ m1Aplicada: false, error: { code, message } })

    const { status, body } = await parseResponse(await GET(createGetRequest(LISTA)))

    expect(status).toBe(200)
    expect(body.total).toBe(2)
    expect(body.data.map((r: any) => r.id)).toEqual(["inv-azul", "inv-suelta"])
    for (const fila of body.data) {
      expect(fila).not.toHaveProperty("grupoId")
      expect(fila).not.toHaveProperty("atributos")
      expect(fila).not.toHaveProperty("etiqueta")
    }
    // Exactly two attempts: the M1 select, then today's select (the old one, byte for byte).
    expect(llamadas).toHaveLength(2)
    expect(llamadas[0].select.endsWith(COLUMNAS_M1)).toBe(true)
    expect(llamadas[1].select).toBe(llamadas[0].select.slice(0, -COLUMNAS_M1.length))
    expect(llamadas[1].select).not.toMatch(/grupo_id|atributos/)
    expect(llamadas[1].select).toContain("tiene_variantes")
  })

  it("the ILIKE retry reuses the downgraded select: no third M1 attempt", async () => {
    const { llamadas } = fakeLista({ m1Aplicada: false, ftsVacio: true })

    const { status, body } = await parseResponse(await GET(createGetRequest(`${LISTA}?search=panta`)))

    expect(status).toBe(200)
    expect(body.data).toHaveLength(2)
    expect(llamadas.map((l) => [l.modo, /grupo_id/.test(l.select)])).toEqual([
      ["fts", true], // M1 attempt, fails
      ["fts", false], // downgraded, finds nothing
      ["ilike", false], // retry stays downgraded
    ])
  })

  it("with M1 applied the rows carry the variant keys and nothing is retried", async () => {
    const { llamadas } = fakeLista({ m1Aplicada: true })

    const { status, body } = await parseResponse(await GET(createGetRequest(LISTA)))

    expect(status).toBe(200)
    expect(llamadas).toHaveLength(1)
    expect(llamadas[0].select.endsWith(COLUMNAS_M1)).toBe(true)
    expect(body.data[0]).toMatchObject({
      id: "inv-azul",
      grupoId: "g-1",
      atributos: azul.atributos,
      etiqueta: "Azul / M",
    })
    expect(body.data[1]).toMatchObject({ id: "inv-suelta", grupoId: null, atributos: null, etiqueta: null })
  })

  it("with M1 applied the ILIKE retry keeps the M1 columns", async () => {
    const { llamadas } = fakeLista({ m1Aplicada: true, ftsVacio: true })

    const { body } = await parseResponse(await GET(createGetRequest(`${LISTA}?search=panta`)))

    expect(body.data[0].grupoId).toBe("g-1")
    expect(llamadas.map((l) => [l.modo, /grupo_id/.test(l.select)])).toEqual([
      ["fts", true],
      ["ilike", true],
    ])
  })

  it("an error that is not a missing column is a 500 and is not retried", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { llamadas } = fakeLista({
      m1Aplicada: false,
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    })

    const { status, body } = await parseResponse(await GET(createGetRequest(LISTA)))

    expect(status).toBe(500)
    expect(body.error).toBe("Error al obtener inventario")
    expect(llamadas).toHaveLength(1)
  })
})
