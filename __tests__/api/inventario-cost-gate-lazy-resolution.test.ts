import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"
import { createChainMock, createGetRequest, parseResponse } from "./helpers"

import { GET as searchGET } from "@/app/api/inventario/search/route"
import { GET as duplicateGET } from "@/app/api/inventario/check-duplicate/route"
import { lazyInventarioAccess } from "@/lib/auth-utils"

/**
 * resolveVendedoresHabilitados is an uncached SELECT on `organizations`, and on
 * these two routes it was resolved eagerly, above the early returns.
 *
 * /api/inventario/search runs on every keystroke of the POS product search
 * (venta-form, venta-edit-form, item-row, inventario-search-combobox all hit
 * it), so every VENDEDOR session paid one extra round trip per key — including
 * on responses that carry no cost at all: no matching deposito, no rows,
 * check-duplicate bailing on an empty query.
 *
 * The gate itself does not move: it is resolved lazily, at the point where the
 * cost would actually be written into the response, and memoized so a request
 * that needs it still pays exactly one round trip.
 */

function organizationsReads() {
  return vi.mocked(supabaseAdmin.from).mock.calls.filter(([table]) => table === "organizations").length
}

function mockFromPerTable(tableChains: Record<string, any>) {
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    return (tableChains[table] || createChainMock(null, { message: `No mock for table: ${table}` })) as any
  })
}

function makeDepositosChain(depositoId: string | null) {
  const chain: any = {}
  for (const m of ["select", "eq", "is"]) chain[m] = vi.fn().mockReturnValue(chain)
  chain.maybeSingle = vi.fn().mockResolvedValue({
    data: depositoId ? { id: depositoId } : null,
    error: null,
  })
  return chain
}

function mockNoCookie() {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn(() => undefined),
    set: vi.fn(),
  } as any)
}

function mockVendedor(sucursalId: string | null = "suc-1") {
  vi.mocked(auth).mockResolvedValue({
    user: {
      id: "vendedor-1",
      organizationId: "org-1",
      role: "VENDEDOR",
      sucursalId,
      email: "v@v.com",
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

function orgChain(vendedoresAdministranInventario: boolean) {
  return createChainMock({ vendedores_administran_inventario: vendedoresAdministranInventario })
}

const duplicateRow = {
  id: "inv-1",
  codigo: "C1",
  nombre: "Pantalla iPhone 12",
  categoria: "Repuestos",
  tipo_dispositivo: "CELULAR",
  stock: 5,
  precio_compra: 300,
  precio_venta: 900,
  proveedor_id: "p1",
  proveedores: { id: "p1", nombre: "Proveedor A" },
}

describe("lazyInventarioAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNoCookie()
  })

  it("does not touch the DB until it is called", async () => {
    mockFromPerTable({ organizations: orgChain(true) })

    lazyInventarioAccess("VENDEDOR", "org-1")

    expect(organizationsReads()).toBe(0)
  })

  it("memoizes: repeated calls cost one round trip", async () => {
    mockFromPerTable({ organizations: orgChain(true) })

    const resolve = lazyInventarioAccess("VENDEDOR", "org-1")
    const [a, b, c] = await Promise.all([resolve(), resolve(), resolve()])

    expect([a, b, c]).toEqual([true, true, true])
    expect(organizationsReads()).toBe(1)
  })

  it("never reads organizations for roles the flag cannot help", async () => {
    mockFromPerTable({ organizations: orgChain(true) })

    // ADMIN passes without the flag; TECNICO is denied regardless of it.
    await expect(lazyInventarioAccess("ADMIN", "org-1")()).resolves.toBe(true)
    await expect(lazyInventarioAccess("TECNICO", "org-1")()).resolves.toBe(false)

    expect(organizationsReads()).toBe(0)
  })

  it("stays fail-closed for a VENDEDOR when the org did not opt in", async () => {
    mockFromPerTable({ organizations: orgChain(false) })

    await expect(lazyInventarioAccess("VENDEDOR", "org-1")()).resolves.toBe(false)
  })
})

describe("GET /api/inventario/check-duplicate — cost gate resolved lazily", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNoCookie()
  })

  it("does not read organizations when the query is empty (early return)", async () => {
    mockVendedor()
    mockFromPerTable({ inventario: createChainMock([duplicateRow]), organizations: orgChain(false) })

    const res = await duplicateGET(
      createGetRequest("http://localhost:3000/api/inventario/check-duplicate?nombre="),
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.matches).toEqual([])
    expect(organizationsReads()).toBe(0)
  })

  it("does not read organizations when nothing clears the similarity threshold", async () => {
    mockVendedor()
    mockFromPerTable({ inventario: createChainMock([duplicateRow]), organizations: orgChain(false) })

    const res = await duplicateGET(
      createGetRequest("http://localhost:3000/api/inventario/check-duplicate?nombre=zzz+qqq+wwww"),
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.matches).toEqual([])
    expect(organizationsReads()).toBe(0)
  })

  it("reads organizations exactly once when the response carries cost, and still gates it", async () => {
    mockVendedor()
    mockFromPerTable({ inventario: createChainMock([duplicateRow]), organizations: orgChain(false) })

    const res = await duplicateGET(
      createGetRequest("http://localhost:3000/api/inventario/check-duplicate?nombre=Pantalla+iPhone+12"),
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.matches[0].precioCompra).toBeNull()
    expect(organizationsReads()).toBe(1)
  })

  it("still returns the cost to a VENDEDOR the org opted in", async () => {
    mockVendedor()
    mockFromPerTable({ inventario: createChainMock([duplicateRow]), organizations: orgChain(true) })

    const res = await duplicateGET(
      createGetRequest("http://localhost:3000/api/inventario/check-duplicate?nombre=Pantalla+iPhone+12"),
    )
    const { body } = await parseResponse(res)

    expect(body.matches[0].precioCompra).toBe(300)
    expect(organizationsReads()).toBe(1)
  })
})

describe("GET /api/inventario/search — cost gate resolved lazily", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNoCookie()
  })

  it("does not read organizations when the sucursal has no principal deposito", async () => {
    mockVendedor()
    mockFromPerTable({
      depositos: makeDepositosChain(null),
      inventario: createChainMock([]),
      organizations: orgChain(false),
    })

    const res = await searchGET(createGetRequest("http://localhost:3000/api/inventario/search?q=note"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body).toEqual([])
    expect(organizationsReads()).toBe(0)
  })

  it("does not read organizations when the search matches nothing", async () => {
    mockVendedor()
    mockFromPerTable({
      depositos: makeDepositosChain("dep-1"),
      inventario: createChainMock([]),
      organizations: orgChain(false),
    })

    const res = await searchGET(createGetRequest("http://localhost:3000/api/inventario/search?q=zzz"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body).toEqual([])
    expect(organizationsReads()).toBe(0)
  })

  it("reads organizations exactly once when rows come back, and still gates the cost", async () => {
    mockVendedor()
    mockFromPerTable({
      depositos: makeDepositosChain("dep-1"),
      inventario: createChainMock([
        {
          id: "i1",
          codigo: "C1",
          nombre: "Notebook",
          precio_venta: 100,
          precio_compra: 60,
          trackea_series: false,
          inventario_depositos: [{ stock: 3, stock_reservado: 0, deposito_id: "dep-1" }],
        },
      ]),
      organizations: orgChain(false),
    })

    const res = await searchGET(createGetRequest("http://localhost:3000/api/inventario/search?q=note"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body[0].precioCompra).toBeNull()
    expect(body[0].precioVenta).toBe(100)
    expect(organizationsReads()).toBe(1)
  })

  it("still returns the cost to a VENDEDOR the org opted in", async () => {
    mockVendedor()
    mockFromPerTable({
      depositos: makeDepositosChain("dep-1"),
      inventario: createChainMock([
        {
          id: "i1",
          codigo: "C1",
          nombre: "Notebook",
          precio_venta: 100,
          precio_compra: 60,
          trackea_series: false,
          inventario_depositos: [{ stock: 3, stock_reservado: 0, deposito_id: "dep-1" }],
        },
      ]),
      organizations: orgChain(true),
    })

    const res = await searchGET(createGetRequest("http://localhost:3000/api/inventario/search?q=note"))
    const { body } = await parseResponse(res)

    expect(body[0].precioCompra).toBe(60)
    expect(organizationsReads()).toBe(1)
  })
})
