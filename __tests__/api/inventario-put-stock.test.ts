/**
 * PUT /api/inventario/[id] — el stock solo se toca si viene en el body, y un
 * ajuste rechazado por la RPC no deja un guardado parcial.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("@/lib/webhooks/dispatcher", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/sucursal", () => ({
  sucursalParaEscritura: vi.fn(),
  getDepositoDeSucursal: vi.fn(),
}))

import { sucursalParaEscritura, getDepositoDeSucursal } from "@/lib/sucursal"
import { supabaseAdmin } from "@/lib/supabase"
import { PUT } from "@/app/api/inventario/[id]/route"

const itemDb = {
  id: "inv-1",
  codigo: "ABC",
  nombre: "Producto",
  categoria: "Pantallas",
  tipo_dispositivo: "CELULAR",
  stock: 9,
  precio_compra: 100,
  precio_venta: 500,
  organization_id: "org-1",
}

function putRequest(body: unknown): [Request, { params: Promise<{ id: string }> }] {
  const req = new Request("http://localhost:3000/api/inventario/inv-1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return [req, { params: Promise.resolve({ id: "inv-1" }) }]
}

describe("PUT /api/inventario/[id] — stock", () => {
  let inventarioChain: ReturnType<typeof createChainMock>

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", sucursalId: null })
    inventarioChain = createChainMock(itemDb)
    mockSupabaseFrom({ inventario: inventarioChain })
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-1")
    vi.mocked(getDepositoDeSucursal).mockResolvedValue("dep-1")
  })

  it("sin stock en el body no llama a la RPC de ajuste", async () => {
    const [req, ctx] = putRequest({ precioVenta: 650 })
    const res = await PUT(req, ctx)

    expect(res.status).toBe(200)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
    expect(inventarioChain.update).toHaveBeenCalledWith(
      expect.not.objectContaining({ stock: expect.anything() })
    )
  })

  it("P0010 devuelve 400 con mensaje claro y NO guarda los demas campos", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0010", message: "Stock insuficiente en el deposito" },
    } as any)

    const [req, ctx] = putRequest({ precioVenta: 650, stock: 2 })
    const res = await PUT(req, ctx)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toMatch(/otros depósitos/i)
    expect(body.error).toContain("2")
    expect(inventarioChain.update).not.toHaveBeenCalled()
  })

  it("P0011 devuelve 400 y tampoco guarda", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0011", message: "sin principal" },
    } as any)

    const { status } = await parseResponse(await PUT(...putRequest({ precioVenta: 650, stock: 2 })))

    expect(status).toBe(400)
    expect(inventarioChain.update).not.toHaveBeenCalled()
  })

  it("con stock distinto ajusta primero y despues guarda los campos; la respuesta trae el stock confirmado", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { stockPosterior: 4 },
      error: null,
    } as any)

    const [req, ctx] = putRequest({ precioVenta: 650, stock: 4 })
    const res = await PUT(req, ctx)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "adjust_stock_atomic",
      expect.objectContaining({ p_mode: "absolute", p_value: 4, p_deposito_id: "dep-1" })
    )
    expect(inventarioChain.update).toHaveBeenCalled()
    expect(body.stock).toBe(4)
    const rpcOrder = vi.mocked(supabaseAdmin.rpc).mock.invocationCallOrder[0]
    const updateOrder = inventarioChain.update.mock.invocationCallOrder[0]
    expect(rpcOrder).toBeLessThan(updateOrder)
  })

  it("P0003 (stock negativo) devuelve 400", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0003", message: "negativo" },
    } as any)

    const { status } = await parseResponse(await PUT(...putRequest({ stock: 2 })))

    expect(status).toBe(400)
    expect(inventarioChain.update).not.toHaveBeenCalled()
  })

  it("un error inesperado de la RPC sigue siendo 500", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "boom" },
    } as any)

    const { status } = await parseResponse(await PUT(...putRequest({ stock: 2 })))

    expect(status).toBe(500)
    expect(inventarioChain.update).not.toHaveBeenCalled()
  })

  it("P0002 (item borrado entre la lectura y la RPC) devuelve 404", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0002", message: "no encontrado" },
    } as any)

    const { status, body } = await parseResponse(await PUT(...putRequest({ stock: 2 })))

    expect(status).toBe(404)
    expect(body.error).toBe("Item no encontrado")
    expect(inventarioChain.update).not.toHaveBeenCalled()
  })

  it("codigo duplicado + cambio de stock: 400 y la RPC NO se llama", async () => {
    // 1ra consulta: el item; 2da: el pre-chequeo de codigo encuentra otro item.
    const duplicado = createChainMock({ id: "inv-2" })
    const calls: ReturnType<typeof createChainMock>[] = [inventarioChain, duplicado]
    let n = 0
    vi.mocked(supabaseAdmin.from).mockImplementation(
      () => (calls[Math.min(n++, calls.length - 1)] ?? inventarioChain) as any
    )

    const { status, body } = await parseResponse(await PUT(...putRequest({ codigo: "DUP-1", stock: 2 })))

    expect(status).toBe(400)
    expect(body.error).toBe("Ya existe un item con ese código")
    expect(duplicado.neq).toHaveBeenCalledWith("id", "inv-1")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
    expect(inventarioChain.update).not.toHaveBeenCalled()
  })

  it("codigo sin cambios no dispara el pre-chequeo", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { stockPosterior: 2 }, error: null } as any)

    const res = await PUT(...putRequest({ codigo: "ABC", stock: 2 }))

    expect(res.status).toBe(200)
    expect(vi.mocked(supabaseAdmin.from)).toHaveBeenCalledTimes(2)
  })
})
