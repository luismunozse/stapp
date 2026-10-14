import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, createGetRequest, parseResponse } from "./helpers"

import { adjuntarFotoDeRespaldo, type ItemParaRespaldo } from "@/lib/variantes-fotos"
import { GET } from "@/app/api/inventario/route"

// The fallback photo is display-only: `imagenUrl` keeps meaning "the row's OWN photo" and the
// borrowed one travels in `imagenRespaldo {url, etiqueta}` (PI-2). The fake below answers BY
// FILTER (G5): the sibling query only returns what `.in("grupo_id")`, the organization,
// `deleted_at IS NULL` and `imagen_url IS NOT NULL` allow, and it serves siblings in REVERSE
// option order so "first returned" differs from "first by option order". Every attempt is
// recorded with its filters, so the tests can prove the scope (org-scoped, never depósito-scoped).

const SELECT_HERMANAS = "id, grupo_id, atributos, imagen_url"
const SELECT_GRUPOS = "id, opciones"

const color = (valor: string) => [{ opcion: "Color", valor }]
const OPCIONES = [{ nombre: "Color", valores: ["Rojo", "Azul", "Verde"] }]

const hijo = (id: string, grupo: string | null, valor: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  organization_id: "org-1",
  grupo_id: grupo,
  atributos: valor ? color(valor) : null,
  imagen_url: null as string | null,
  deleted_at: null as string | null,
  ...extra,
})

// Stored rows, deliberately in REVERSE option order (Verde, Azul, Rojo).
const ALMACEN = [
  hijo("verde", "g-1", "Verde", { imagen_url: "https://f/verde.jpg" }),
  hijo("azul", "g-1", "Azul"),
  hijo("rojo", "g-1", "Rojo", { imagen_url: "https://f/rojo.jpg" }),
  // g-2: its only photo belongs to an ARCHIVED row, which never lends.
  hijo("g2-verde", "g-2", "Verde"),
  hijo("g2-rojo", "g-2", "Rojo", { imagen_url: "https://f/g2-rojo.jpg", deleted_at: "2026-01-01T00:00:00Z" }),
  // Another organization's group with a clashing group id.
  hijo("ajeno", "g-1", "Rojo", { organization_id: "org-2", imagen_url: "https://f/ajeno.jpg" }),
]
const GRUPOS = [
  { id: "g-1", organization_id: "org-1", opciones: OPCIONES },
  { id: "g-2", organization_id: "org-1", opciones: OPCIONES },
  { id: "g-1", organization_id: "org-2", opciones: [{ nombre: "Color", valores: ["Verde", "Azul", "Rojo"] }] },
]

interface Intento {
  tabla: string
  select: string
  eq: [string, unknown][]
  is: [string, unknown][]
  in: [string, unknown[]][]
  not: [string, string, unknown][]
  limit: number | null
}

function fakeHermanos(opts: { filasDeLista?: Record<string, unknown>[]; fallar?: "hermanos" | "grupos" | "lanzar" } = {}) {
  const intentos: Intento[] = []
  vi.mocked(supabaseAdmin.from).mockImplementation(((tabla: string) => {
    const intento: Intento = { tabla, select: "", eq: [], is: [], in: [], not: [], limit: null }
    const api: any = {
      select: (columnas: string) => ((intento.select = columnas), intentos.push(intento), api),
      eq: (c: string, v: unknown) => (intento.eq.push([c, v]), api),
      is: (c: string, v: unknown) => (intento.is.push([c, v]), api),
      in: (c: string, v: unknown[]) => (intento.in.push([c, v]), api),
      not: (c: string, op: string, v: unknown) => (intento.not.push([c, op, v]), api),
      limit: (n: number) => ((intento.limit = n), api),
      order: () => api,
      range: () => api,
      or: () => api,
      textSearch: () => api,
      then: (resolve: any, reject?: any) => {
        let resultado: Record<string, unknown>
        if (intento.select === SELECT_HERMANAS) {
          if (opts.fallar === "lanzar") return Promise.reject(new Error("socket hang up")).then(resolve, reject)
          if (opts.fallar === "hermanos") {
            resultado = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }
          } else {
            const grupos = intento.in.find(([c]) => c === "grupo_id")?.[1] ?? []
            const datos = ALMACEN.filter(
              (f) =>
                intento.eq.every(([c, v]) => (f as Record<string, unknown>)[c] === v) &&
                intento.is.every(([c, v]) => ((f as Record<string, unknown>)[c] ?? null) === v) &&
                intento.not.every(([c, op, v]) => op !== "is" || ((f as Record<string, unknown>)[c] ?? null) !== v) &&
                grupos.includes(f.grupo_id)
            ).map(({ id, grupo_id, atributos, imagen_url }) => ({ id, grupo_id, atributos, imagen_url }))
            resultado = { data: datos, error: null }
          }
        } else if (intento.select === SELECT_GRUPOS) {
          if (opts.fallar === "grupos") {
            resultado = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }
          } else {
            const ids = intento.in.find(([c]) => c === "id")?.[1] ?? []
            resultado = {
              data: GRUPOS.filter(
                (g) => ids.includes(g.id) && intento.eq.every(([c, v]) => (g as Record<string, unknown>)[c] === v)
              ).map(({ id, opciones }) => ({ id, opciones })),
              error: null,
            }
          }
        } else {
          // The inventory list itself.
          resultado = { data: opts.filasDeLista ?? [], error: null, count: (opts.filasDeLista ?? []).length }
        }
        return Promise.resolve(resultado).then(resolve, reject)
      },
    }
    return api
  }) as any)
  return { intentos }
}

const item = (id: string, grupoId: string | null, valor: string | null, imagenUrl: string | null): ItemParaRespaldo => ({
  id,
  grupoId,
  atributos: valor ? color(valor) : null,
  imagenUrl,
})

describe("adjuntarFotoDeRespaldo", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("gives a row without a photo the first sibling photo by OPTION order and keeps imagenUrl null", async () => {
    const { intentos } = fakeHermanos()
    const [azul] = await adjuntarFotoDeRespaldo("org-1", [item("azul", "g-1", "Azul", null)])

    // Rojo and Verde both have photos; Rojo is first in the option even though Verde is served first.
    expect(azul.imagenRespaldo).toEqual({ url: "https://f/rojo.jpg", etiqueta: "Rojo" })
    expect(azul.imagenUrl).toBeNull()
    expect(intentos).toHaveLength(2)
  })

  it("is two queries for the whole page, never one per row", async () => {
    const { intentos } = fakeHermanos()
    const salida = await adjuntarFotoDeRespaldo("org-1", [
      item("azul", "g-1", "Azul", null),
      item("g2-verde", "g-2", "Verde", null),
      item("verde", "g-1", "Verde", "https://f/verde.jpg"),
      item("suelto", null, null, null),
    ])

    expect(intentos.map((i) => i.tabla).sort()).toEqual(["inventario", "inventario_grupos"])
    // Only the groups that have a row lacking a photo are asked for.
    const hermanos = intentos.find((i) => i.select === SELECT_HERMANAS)!
    expect(hermanos.in).toEqual([["grupo_id", ["g-1", "g-2"]]])
    expect(salida.map((s) => s.imagenRespaldo ?? null)).toEqual([
      { url: "https://f/rojo.jpg", etiqueta: "Rojo" },
      null, // g-2: the only photo is on an archived row
      null, // has its own photo
      null, // standalone
    ])
  })

  it("scopes both queries to the organization and to ACTIVE siblings with a photo, never to a depósito", async () => {
    const { intentos } = fakeHermanos()
    // g-3 has a row WITH its photo on this page, so its group is not asked for.
    await adjuntarFotoDeRespaldo("org-1", [item("azul", "g-1", "Azul", null), item("g3", "g-3", "Rojo", "https://f/g3.jpg")])

    const hermanos = intentos.find((i) => i.select === SELECT_HERMANAS)!
    expect(hermanos.in).toEqual([["grupo_id", ["g-1"]]])
    expect(hermanos.eq).toEqual([["organization_id", "org-1"]])
    expect(hermanos.is).toEqual([["deleted_at", null]])
    expect(hermanos.not).toEqual([["imagen_url", "is", null]])
    expect(hermanos.limit).toBe(2000)
    const grupos = intentos.find((i) => i.select === SELECT_GRUPOS)!
    expect(grupos.eq).toEqual([["organization_id", "org-1"]])
    expect(JSON.stringify(intentos)).not.toContain("deposito")
  })

  it("never borrows from an archived sibling or from another organization", async () => {
    fakeHermanos()
    const [g2verde] = await adjuntarFotoDeRespaldo("org-1", [item("g2-verde", "g-2", "Verde", null)])
    expect(g2verde).not.toHaveProperty("imagenRespaldo")

    // org-2 has its own g-1 with a photo on Rojo; org-1's Azul must never see it.
    const [azul] = await adjuntarFotoDeRespaldo("org-1", [item("azul", "g-1", "Azul", null)])
    expect(azul.imagenRespaldo?.url).toBe("https://f/rojo.jpg")
    const [ajeno] = await adjuntarFotoDeRespaldo("org-2", [item("x", "g-1", "Verde", null)])
    expect(ajeno.imagenRespaldo).toEqual({ url: "https://f/ajeno.jpg", etiqueta: "Rojo" })
  })

  it("runs no query when every grouped row has a photo or nothing is grouped", async () => {
    const { intentos } = fakeHermanos()
    const todos = [item("rojo", "g-1", "Rojo", "https://f/rojo.jpg"), item("suelto", null, null, null)]
    const salida = await adjuntarFotoDeRespaldo("org-1", todos)

    expect(intentos).toHaveLength(0)
    expect(salida).toBe(todos)
    expect(await adjuntarFotoDeRespaldo("org-1", [])).toEqual([])
    expect(intentos).toHaveLength(0)
  })

  it.each([
    ["the sibling query errors", "hermanos"],
    ["the options query errors", "grupos"],
    ["the query throws", "lanzar"],
  ] as const)("is best-effort: when %s the items come back unchanged", async (_caso, fallar) => {
    fakeHermanos({ fallar })
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {})
    const entrada = [item("azul", "g-1", "Azul", null)]

    const salida = await adjuntarFotoDeRespaldo("org-1", entrada)

    expect(salida).toEqual(entrada)
    expect(salida[0]).not.toHaveProperty("imagenRespaldo")
    expect(aviso).toHaveBeenCalledTimes(1)
    aviso.mockRestore()
  })

  it("leaves a row alone when its group options are unknown (no way to order the siblings)", async () => {
    fakeHermanos()
    const [desconocido] = await adjuntarFotoDeRespaldo("org-1", [item("z", "g-inexistente", "Azul", null)])
    expect(desconocido).not.toHaveProperty("imagenRespaldo")
  })
})

describe("GET /api/inventario: imagenRespaldo on the list", () => {
  const LISTA = "http://localhost:3000/api/inventario"
  const fila = (id: string, grupo: string | null, valor: string | null, imagen: string | null) => ({
    ...hijo(id, grupo, valor, { imagen_url: imagen }),
    nombre: id,
    codigo: id,
    categoria: "Fundas",
    tipo_dispositivo: "CELULAR",
    stock: 1,
    precio_compra: 1,
    precio_venta: 2,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
  })
  afterEach(() => vi.restoreAllMocks())

  it("adds the borrowed photo to a variant without one, keeps its own imagenUrl null and costs 2 extra queries", async () => {
    const { intentos } = fakeHermanos({
      filasDeLista: [fila("azul", "g-1", "Azul", null), fila("rojo", "g-1", "Rojo", "https://f/rojo.jpg"), fila("suelto", null, null, null)],
    })

    const { status, body } = await parseResponse(await GET(createGetRequest(LISTA)))

    expect(status).toBe(200)
    const [azul, rojo, suelto] = body.data
    expect(azul.imagenUrl).toBeNull()
    expect(azul.imagenRespaldo).toEqual({ url: "https://f/rojo.jpg", etiqueta: "Rojo" })
    expect(rojo.imagenUrl).toBe("https://f/rojo.jpg")
    expect(rojo).not.toHaveProperty("imagenRespaldo")
    expect(suelto).not.toHaveProperty("imagenRespaldo")
    expect(intentos).toHaveLength(3) // the list + siblings + options
  })

  it("adds no query when every variant has a photo or the page has no group", async () => {
    const { intentos } = fakeHermanos({
      filasDeLista: [fila("rojo", "g-1", "Rojo", "https://f/rojo.jpg"), fila("suelto", null, null, null)],
    })
    const { status, body } = await parseResponse(await GET(createGetRequest(LISTA)))

    expect(status).toBe(200)
    expect(body.data).toHaveLength(2)
    expect(intentos).toHaveLength(1)
  })

  it("still answers 200 with the plain rows when the fallback lookup fails", async () => {
    fakeHermanos({
      fallar: "hermanos",
      filasDeLista: [fila("azul", "g-1", "Azul", null)],
    })
    vi.spyOn(console, "warn").mockImplementation(() => {})

    const { status, body } = await parseResponse(await GET(createGetRequest(LISTA)))

    expect(status).toBe(200)
    expect(body.data[0].id).toBe("azul")
    expect(body.data[0]).not.toHaveProperty("imagenRespaldo")
  })
})
