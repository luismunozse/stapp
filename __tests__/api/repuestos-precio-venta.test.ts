import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

import { supabaseAdmin } from "@/lib/supabase"
import { POST } from "@/app/api/ordenes/[id]/repuestos/route"

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

/** Devuelve el chain de repuestos_orden para inspeccionar el insert. */
function mockAlta() {
  const repuestos = createChainMock(null)
  mockSupabaseFrom({
    ordenes_servicio: createChainMock({ id: "o1" }),
    repuestos_orden: repuestos,
    inventario: createChainMock({ id: "inv-1" }),
  })
  return repuestos
}

describe("POST /api/ordenes/[id]/repuestos — costo y precio de venta en repuestos manuales", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { success: true }, error: null } as any)
  })

  it("guarda los dos numeros por separado", async () => {
    mockAuthSuccess()
    const repuestos = mockAlta()

    const res = await POST(
      createPostRequest({
        tipo: "manual",
        nombre: "Flex de carga",
        cantidad: 2,
        precioUnitario: 3000,
        precioVentaUnitario: 8000,
      }),
      createParams("o1")
    )

    expect((await parseResponse(res)).status).toBe(201)
    expect(repuestos.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        nombre: "Flex de carga",
        cantidad: 2,
        precio_unitario: 3000,
        precio_venta_unitario: 8000,
      })
    )
  })

  it("usa el costo como precio de venta si no se informa (comportamiento previo)", async () => {
    mockAuthSuccess()
    const repuestos = mockAlta()

    const res = await POST(
      createPostRequest({
        tipo: "manual",
        nombre: "Tornillo",
        cantidad: 1,
        precioUnitario: 500,
      }),
      createParams("o1")
    )

    expect((await parseResponse(res)).status).toBe(201)
    expect(repuestos.insert).toHaveBeenCalledWith(
      expect.objectContaining({ precio_unitario: 500, precio_venta_unitario: 500 })
    )
  })

  it("rechaza un precio de venta negativo", async () => {
    mockAuthSuccess()
    mockAlta()

    const res = await POST(
      createPostRequest({
        tipo: "manual",
        nombre: "Flex",
        cantidad: 1,
        precioUnitario: 100,
        precioVentaUnitario: -50,
      }),
      createParams("o1")
    )

    expect((await parseResponse(res)).status).toBe(400)
  })

  it("el alta desde inventario sigue delegando en el RPC, que congela ambos precios", async () => {
    mockAuthSuccess()
    mockAlta()

    const res = await POST(
      createPostRequest({ tipo: "inventario", inventarioId: "inv-1", cantidad: 1 }),
      createParams("o1")
    )

    expect((await parseResponse(res)).status).toBe(201)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("add_repuesto_inventario", {
      p_orden_id: "o1",
      p_inventario_id: "inv-1",
      p_cantidad: 1,
    })
  })
})
