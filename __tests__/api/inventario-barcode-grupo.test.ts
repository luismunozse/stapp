import { describe, it, expect, vi, beforeEach } from "vitest"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, createGetRequest, parseResponse } from "./helpers"
import { resetCacheResolucionVenta } from "@/lib/sucursal"

import { GET } from "@/app/api/inventario/barcode/route"

// Barcode scan: a variant comes back with the additive fields (grupoId, etiqueta, atributos
// from the `select("*")` row, grupoNombre from ONE best-effort lookup by grupo_id) and keeps
// the per-deposito stock override of scope=venta. A standalone item costs no extra query, and
// a failing group lookup never fails the scan.

const base = {
  organization_id: "org-1",
  precio_compra: 200,
  precio_venta: 500,
  stock: 10,
  stock_reservado: 1,
  trackea_series: false,
  proveedor_id: null,
  proveedores: null,
  deleted_at: null,
}
const AZUL = {
  ...base,
  id: "azul",
  codigo: "FX-AZ",
  nombre: "Funda X - Azul / M",
  barcode: "7790001",
  grupo_id: "g-1",
  atributos: [
    { opcion: "Color", valor: "Azul" },
    { opcion: "Talle", valor: "M" },
  ],
}
const SUELTO = { ...base, id: "suelto", codigo: "PAN-1", nombre: "Pantalla", barcode: "7790002", grupo_id: null, atributos: null }
// An item read before migration 355: the row has no grupo_id key at all.
const SIN_M1 = { ...base, id: "viejo", codigo: "OLD-1", nombre: "Cable", barcode: "7790003" }

interface Llamada {
  tabla: string
  eq: [string, unknown][]
  select: string
}

function fake(rows: Record<string, unknown>[], opts: { grupoError?: { code: string; message: string } | "lanzar"; stockDeposito?: number } = {}) {
  const llamadas: Llamada[] = []
  vi.mocked(supabaseAdmin.from).mockImplementation(((tabla: string) => {
    const llamada: Llamada = { tabla, eq: [], select: "" }
    llamadas.push(llamada)
    const q: any = {
      select: (c: string) => ((llamada.select = c), q),
      eq: (c: string, v: unknown) => (llamada.eq.push([c, v]), q),
      is: () => q,
      order: () => q,
      limit: () => q,
      ilike: (c: string, v: string) => {
        llamada.eq.push([`ilike:${c}`, v])
        return q
      },
      maybeSingle: () => {
        if (tabla === "inventario_grupos") {
          if (opts.grupoError === "lanzar") return Promise.reject(new Error("socket hang up"))
          if (opts.grupoError) return Promise.resolve({ data: null, error: opts.grupoError })
          const id = llamada.eq.find(([c]) => c === "id")?.[1]
          const org = llamada.eq.find(([c]) => c === "organization_id")?.[1]
          const grupos: Record<string, { org: string; nombre: string }> = {
            "g-1": { org: "org-1", nombre: "Funda X" },
            "g-2": { org: "org-2", nombre: "Funda de otra org" },
          }
          const g = grupos[id as string]
          return Promise.resolve({ data: g && (org === undefined || g.org === org) ? { nombre: g.nombre } : null, error: null })
        }
        if (tabla === "inventario_depositos") {
          return Promise.resolve({ data: { stock: opts.stockDeposito ?? 0, stock_reservado: 0 }, error: null })
        }
        if (tabla === "depositos") return Promise.resolve({ data: { id: "dep-1" }, error: null })
        return Promise.resolve({ data: null, error: null })
      },
      single: () => Promise.resolve({ data: { id: "suc-1", nombre: "Casa Central" }, error: null }),
      then: (resolve: any, reject?: any) => {
        const code = llamada.eq.find(([c]) => c === "ilike:barcode" || c === "ilike:codigo")
        const columna = code?.[0].replace("ilike:", "") as string
        const datos = rows.filter((r) => String(r[columna]).toLowerCase() === String(code?.[1]).toLowerCase())
        return Promise.resolve({ data: datos, error: null }).then(resolve, reject)
      },
    }
    return q
  }) as any)
  return { llamadas }
}

const escanear = async (code: string, extra = "") =>
  parseResponse(await GET(createGetRequest(`http://localhost:3000/api/inventario/barcode?code=${code}${extra}`)))

describe("GET /api/inventario/barcode: variant fields", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetCacheResolucionVenta()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn(() => undefined), set: vi.fn() } as any)
  })

  it("returns grupoId, etiqueta, atributos and grupoNombre for a variant", async () => {
    const { llamadas } = fake([AZUL, SUELTO])

    const { status, body } = await escanear("7790001")

    expect(status).toBe(200)
    expect(body.item).toMatchObject({
      id: "azul",
      grupoId: "g-1",
      etiqueta: "Azul / M",
      atributos: [
        { opcion: "Color", valor: "Azul" },
        { opcion: "Talle", valor: "M" },
      ],
      grupoNombre: "Funda X",
    })
    // One lookup, by the item's group, scoped to the organization.
    const grupos = llamadas.filter((l) => l.tabla === "inventario_grupos")
    expect(grupos).toHaveLength(1)
    expect(grupos[0].select).toBe("nombre")
    expect(grupos[0].eq).toEqual([
      ["id", "g-1"],
      ["organization_id", "org-1"],
    ])
  })

  it("finds a variant by its code too", async () => {
    fake([AZUL])
    const { body } = await escanear("fx-az")
    expect(body).toMatchObject({ found: true, matchedByCodigo: true, item: { id: "azul", grupoNombre: "Funda X" } })
  })

  it("costs a standalone item no extra query and gives it no group name", async () => {
    const { llamadas } = fake([SUELTO])

    const { body } = await escanear("7790002")

    expect(body.item).toMatchObject({ id: "suelto", grupoId: null, atributos: null, etiqueta: null, grupoNombre: null })
    expect(llamadas.map((l) => l.tabla)).toEqual(["inventario"])
  })

  it("adds none of the variant keys to an item read without the migration", async () => {
    const { llamadas } = fake([SIN_M1])
    const { status, body } = await escanear("7790003")
    expect(status).toBe(200)
    for (const clave of ["grupoId", "atributos", "etiqueta", "grupoNombre"]) expect(body.item).not.toHaveProperty(clave)
    expect(llamadas.map((l) => l.tabla)).toEqual(["inventario"])
  })

  it.each([
    ["the lookup answers an error", { code: "42P01", message: 'relation "inventario_grupos" does not exist' }],
    ["the lookup throws", "lanzar"],
  ] as const)("still answers 200 with the item when %s", async (_caso, grupoError) => {
    fake([AZUL], { grupoError })
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {})

    const { status, body } = await escanear("7790001")
    // The failure is logged, not swallowed silently.
    expect(aviso).toHaveBeenCalledTimes(1)
    aviso.mockRestore()

    expect(status).toBe(200)
    expect(body.found).toBe(true)
    expect(body.item).toMatchObject({ id: "azul", grupoId: "g-1", etiqueta: "Azul / M", grupoNombre: null })
  })

  it("keeps the per-deposito stock override of scope=venta on a variant", async () => {
    fake([AZUL], { stockDeposito: 3 })

    const { body } = await escanear("7790001", "&scope=venta")

    expect(body.item).toMatchObject({ id: "azul", stock: 3, stockReservado: 0, grupoNombre: "Funda X" })
  })

  it("never reads another organization's group name", async () => {
    fake([{ ...AZUL, grupo_id: "g-2" }])
    const { body } = await escanear("7790001")
    expect(body.item.grupoId).toBe("g-2")
    expect(body.item.grupoNombre).toBeNull()
  })
})
