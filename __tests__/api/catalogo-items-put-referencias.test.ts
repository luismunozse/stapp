// @vitest-environment node
/**
 * PUT /api/catalogo/items/[id]: categoría e item de inventario tienen que ser
 * de la organización, igual que en el alta.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"

vi.mock("@/lib/catalogo/revalidate", () => ({ revalidateCatalogo: vi.fn().mockResolvedValue(undefined) }))

import { PUT } from "@/app/api/catalogo/items/[id]/route"

const EXISTENTE = { tipo: "PRODUCTO", precio: 100, precio_hasta: null, inventario_id: null }

function put(body: unknown) {
  return PUT(
    new Request("http://localhost/api/catalogo/items/it-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "it-1" }) }
  )
}

describe("PUT /api/catalogo/items/[id] — referencias", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
  })

  it("400 y no actualiza con un inventario_id de otra organización", async () => {
    const items = createChainMock(EXISTENTE)
    const inventario = createChainMock(null)
    mockSupabaseFrom({ catalogo_items: items, inventario })

    const { status } = await parseResponse(await put({ inventario_id: "inv-ajeno" }))

    expect(status).toBe(400)
    expect(inventario.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(items.update).not.toHaveBeenCalled()
  })

  it("400 y no actualiza con una categoría de otra organización", async () => {
    const items = createChainMock(EXISTENTE)
    const categorias = createChainMock(null)
    mockSupabaseFrom({ catalogo_items: items, catalogo_categorias: categorias })

    const { status } = await parseResponse(await put({ categoria_id: "cat-ajena" }))

    expect(status).toBe(400)
    expect(categorias.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(items.update).not.toHaveBeenCalled()
  })

  it("200 con referencias propias", async () => {
    const items = createChainMock(EXISTENTE)
    mockSupabaseFrom({
      catalogo_items: items,
      inventario: createChainMock({ id: "inv-1" }),
      catalogo_categorias: createChainMock({ id: "cat-1" }),
    })

    const { status } = await parseResponse(await put({ inventario_id: "inv-1", categoria_id: "cat-1" }))

    expect(status).toBe(200)
    expect(items.update).toHaveBeenCalled()
  })

  it("desvincular (null) no consulta inventario", async () => {
    const items = createChainMock({ ...EXISTENTE, inventario_id: "inv-1" })
    mockSupabaseFrom({ catalogo_items: items })

    const { status } = await parseResponse(await put({ inventario_id: null }))

    expect(status).toBe(200)
  })
})
