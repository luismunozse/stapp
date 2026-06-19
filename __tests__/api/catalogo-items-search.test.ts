import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, mockAuthError, createChainMock, createGetRequest, parseResponse } from "./helpers"
import { GET } from "@/app/api/catalogo/items/route"

function mockTables(chains: Record<string, any>) {
  vi.mocked(supabaseAdmin.from).mockImplementation((t: string) =>
    (chains[t] || createChainMock(null, { message: `no mock ${t}` })) as any)
}

const BASE = "http://localhost:3000/api/catalogo/items"

describe("GET /api/catalogo/items — search + pagination", () => {
  beforeEach(() => vi.clearAllMocks())

  it("401 when unauthenticated", async () => {
    mockAuthError()
    const res = await GET(createGetRequest(BASE))
    expect((await parseResponse(res)).status).toBe(401)
  })

  it("no q: queries items with range + returns pagination meta", async () => {
    mockAuthSuccess()
    const itemsChain = createChainMock([{ id: "i1" }], null, 1)
    mockTables({ catalogo_items: itemsChain })

    const res = await GET(createGetRequest(`${BASE}?page=2&limit=20`))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(itemsChain.range).toHaveBeenCalledWith(20, 39)
    expect(body).toMatchObject({ total: 1, page: 2, limit: 20, totalPages: 1 })
    expect(Array.isArray(body.items)).toBe(true)
  })

  it("q matches name only when no variant/inventario hits → ilike on nombre", async () => {
    mockAuthSuccess()
    const variantes = createChainMock([])
    const inventario = createChainMock([])
    const itemsChain = createChainMock([], null, 0)
    mockTables({ catalogo_variantes: variantes, inventario, catalogo_items: itemsChain })

    await GET(createGetRequest(`${BASE}?q=nokia`))
    expect(itemsChain.ilike).toHaveBeenCalledWith("nombre", "%nokia%")
    expect(itemsChain.or).not.toHaveBeenCalled()
  })

  it("q matches a variant SKU → .or includes id.in", async () => {
    mockAuthSuccess()
    const variantes = createChainMock([{ item_id: "itemA" }])
    const inventario = createChainMock([])
    const itemsChain = createChainMock([], null, 0)
    mockTables({ catalogo_variantes: variantes, inventario, catalogo_items: itemsChain })

    await GET(createGetRequest(`${BASE}?q=SKU123`))
    expect(itemsChain.or).toHaveBeenCalledTimes(1)
    const filter = itemsChain.or.mock.calls[0][0] as string
    expect(filter).toContain("nombre.ilike.%SKU123%")
    expect(filter).toContain("id.in.(itemA)")
  })

  it("q matches an inventario codigo → .or includes inventario_id.in", async () => {
    mockAuthSuccess()
    const variantes = createChainMock([])
    const inventario = createChainMock([{ id: "invB" }])
    const itemsChain = createChainMock([], null, 0)
    mockTables({ catalogo_variantes: variantes, inventario, catalogo_items: itemsChain })

    await GET(createGetRequest(`${BASE}?q=COD9`))
    const filter = itemsChain.or.mock.calls[0][0] as string
    expect(filter).toContain("inventario_id.in.(invB)")
  })

  it("sanitizes dangerous chars in q", async () => {
    mockAuthSuccess()
    const variantes = createChainMock([])
    const inventario = createChainMock([])
    const itemsChain = createChainMock([], null, 0)
    mockTables({ catalogo_variantes: variantes, inventario, catalogo_items: itemsChain })

    await GET(createGetRequest(`${BASE}?q=${encodeURIComponent("a,b)(*")}`))
    const arg = itemsChain.ilike.mock.calls[0]?.[1] as string
    expect(arg).not.toContain(",")
    expect(arg).not.toContain(")")
    expect(arg).not.toContain("(")
    expect(arg).not.toContain("*")
  })

  it("applies tipo + estado + sin_imagen filters and scopes by org", async () => {
    mockAuthSuccess()
    const itemsChain = createChainMock([], null, 0)
    mockTables({ catalogo_items: itemsChain })

    await GET(createGetRequest(`${BASE}?tipo=PRODUCTO&estado=inactivo&sin_imagen=1`))
    expect(itemsChain.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(itemsChain.eq).toHaveBeenCalledWith("tipo", "PRODUCTO")
    expect(itemsChain.eq).toHaveBeenCalledWith("activo", false)
    expect(itemsChain.is).toHaveBeenCalledWith("imagen_url", null)
  })
})
