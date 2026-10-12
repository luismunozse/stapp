import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, parseResponse, createPostRequest } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

import { POST } from "@/app/api/notas-credito/route"

type Rows = { data: any; error: any }

/**
 * `inventario` e `items_venta` devuelven las filas que se les indique (lo que la
 * base "encontro" para el filtro de la org); el resto responde como una venta propia.
 */
function setup(opts: { inventario?: Rows; itemsVenta?: Rows } = {}) {
  const fromCalls: string[] = []
  const chains: Record<string, any> = {}
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { id: "nc1", numero: "NC-0001" }, error: null } as any)
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    fromCalls.push(table)
    if (table === "ventas") return createChainMock({ id: "v1", total: "500", sucursal_id: "suc-1" }) as any
    if (table === "inventario") {
      const r = opts.inventario ?? { data: [], error: null }
      return (chains.inventario = createChainMock(r.data, r.error)) as any
    }
    if (table === "items_venta") {
      const r = opts.itemsVenta ?? { data: [], error: null }
      return (chains.items_venta = createChainMock(r.data, r.error)) as any
    }
    return createChainMock(null) as any
  })
  return { fromCalls, chains }
}

const base = { ventaId: "v1", motivo: "DEVOLUCION", monto: 100, metodoDevolucion: "TRANSFERENCIA" }
const item = (extra: Record<string, unknown>) => ({
  descripcion: "Pantalla",
  cantidad: 1,
  precioUnitario: 100,
  restock: true,
  ...extra,
})
const post = (body: unknown) => POST(createPostRequest(body, "http://localhost/api/notas-credito"))

describe("nota de crédito — los ids de producto/ítem deben ser de la organización", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
  })

  it("inventarioId de otra org -> 400 y no llama a la RPC", async () => {
    const { chains } = setup({ inventario: { data: [], error: null } })

    const res = await parseResponse(await post({ ...base, items: [item({ inventarioId: "inv-ajeno" })] }))

    expect(res.status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
    expect(chains.inventario.eq).toHaveBeenCalledWith("organization_id", expect.any(String))
  })

  it("uno propio y uno ajeno -> 400 (el conjunto debe coincidir)", async () => {
    setup({ inventario: { data: [{ id: "inv-1" }], error: null } })

    const res = await parseResponse(
      await post({ ...base, items: [item({ inventarioId: "inv-1" }), item({ inventarioId: "inv-ajeno" })] })
    )

    expect(res.status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("itemVentaId que no es de la venta/org -> 400 y no llama a la RPC", async () => {
    const { chains } = setup({ itemsVenta: { data: [], error: null } })

    const res = await parseResponse(await post({ ...base, items: [item({ itemVentaId: "iv-ajeno" })] }))

    expect(res.status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
    expect(chains.items_venta.eq).toHaveBeenCalledWith("venta_id", "v1")
  })

  it("ids propios -> llama a la RPC con el payload de siempre", async () => {
    setup({
      inventario: { data: [{ id: "inv-1" }], error: null },
      itemsVenta: { data: [{ id: "iv-1" }], error: null },
    })

    const res = await parseResponse(
      await post({ ...base, items: [item({ inventarioId: "inv-1", itemVentaId: "iv-1" }), item({ inventarioId: "inv-1" })] })
    )

    expect(res.status).toBe(201)
    const args = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any
    expect(args.p_items).toEqual([
      { item_venta_id: "iv-1", inventario_id: "inv-1", descripcion: "Pantalla", cantidad: 1, precio_unitario: 100, restock: true },
      { item_venta_id: null, inventario_id: "inv-1", descripcion: "Pantalla", cantidad: 1, precio_unitario: 100, restock: true },
    ])
  })

  it("sin items o items sin ids -> no consulta inventario ni items_venta", async () => {
    const { fromCalls } = setup()

    expect((await parseResponse(await post(base))).status).toBe(201)
    expect((await parseResponse(await post({ ...base, items: [item({})] }))).status).toBe(201)

    expect(fromCalls).not.toContain("inventario")
    expect(fromCalls).not.toContain("items_venta")
    expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(2)
  })

  it("error en la consulta de inventario -> 500 y no llama a la RPC", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    setup({ inventario: { data: null, error: { message: "boom" } } })

    const res = await parseResponse(await post({ ...base, items: [item({ inventarioId: "inv-1" })] }))

    expect(res.status).toBe(500)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("error en la consulta de items_venta -> 500 y no llama a la RPC", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    setup({ itemsVenta: { data: null, error: { message: "boom" } } })

    const res = await parseResponse(await post({ ...base, items: [item({ itemVentaId: "iv-1" })] }))

    expect(res.status).toBe(500)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })
})
