import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createPostRequest, parseResponse } from "./helpers"

// The public catalog has no currency: an item priced in USD/EUR is imported without a price
// ("consultar"), never with its foreign number as if it were local.
vi.mock("@/lib/catalogo/revalidate", () => ({ revalidateCatalogo: vi.fn() }))
vi.mock("@/lib/subscriptions", () => ({ hasPlanFeature: vi.fn().mockResolvedValue(true) }))

import { POST } from "@/app/api/catalogo/items/import-inventario/route"
import { POST as cotizar } from "@/app/api/public/catalogo/[slug]/cotizar/route"

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthSuccess({ role: "ADMIN" })
})

describe("POST /api/catalogo/items/import-inventario", () => {
  it("a foreign-currency item is imported with precio null; a local one keeps its price", async () => {
    const catalogo = createChainMock([])
    mockSupabaseFrom({
      inventario: createChainMock([
        { id: "loc", nombre: "Local", descripcion: null, precio_venta: 800, moneda: null },
        { id: "usd", nombre: "Dolar", descripcion: null, precio_venta: 20, moneda: "USD" },
      ]),
      catalogo_items: catalogo,
    })

    const res = await POST(createPostRequest({ inventarioIds: ["loc", "usd"] }))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    const filas = catalogo.insert.mock.calls[0][0] as { inventario_id: string; precio: number | null }[]
    expect(filas.find((f) => f.inventario_id === "loc")!.precio).toBe(800)
    expect(filas.find((f) => f.inventario_id === "usd")!.precio).toBeNull()
    expect(body.sinPrecioPorDivisa).toBe(1)
  })

  it("only local items: nothing is flagged", async () => {
    const catalogo = createChainMock([])
    mockSupabaseFrom({
      inventario: createChainMock([{ id: "loc", nombre: "Local", descripcion: null, precio_venta: 800, moneda: null }]),
      catalogo_items: catalogo,
    })
    const { body } = await parseResponse(await POST(createPostRequest({ inventarioIds: ["loc"] })))
    expect(body.sinPrecioPorDivisa).toBe(0)
    expect(catalogo.insert.mock.calls[0][0][0].precio).toBe(800)
  })

  it("the public quote refuses an imported foreign item (precio null): no line at a raw foreign number", async () => {
    mockSupabaseFrom({
      catalogo_config: createChainMock({ organization_id: "org-1", activo: true, whatsapp: null, titulo: "X" }),
      catalogo_items: createChainMock([
        { id: "c1", nombre: "Dolar", precio: null, stock: null, inventario_id: null, activo: true, tipo: "PRODUCTO", inventario: null, variantes: [] },
      ]),
    })
    const res = await cotizar(
      createPostRequest({ cliente: { nombre: "Ana", telefono: "1122334455" }, consent: true, items: [{ itemId: "c1", cantidad: 1 }] }),
      { params: Promise.resolve({ slug: "mi-taller" }) }
    )
    const { status, body } = await parseResponse(res)
    expect(status).toBe(400)
    expect(body.error).toContain("requiere consulta de precio")
  })
})
