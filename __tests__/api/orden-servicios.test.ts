import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

import { POST } from "@/app/api/ordenes/[id]/servicios/route"

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe("POST /api/ordenes/[id]/servicios", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ organizationId: "org-1", role: "TECNICO" })
  })

  it("agrega una linea ad-hoc y autocompleta costo_final", async () => {
    const ordenChain = createChainMock({
      id: "ord-1", costo_final: null, total_cobrado: 0, organization_id: "org-1",
    })
    const lineasChain = createChainMock([])
    const insertChain = createChainMock({
      id: "lin-1", servicio_id: null, nombre: "Instalacion de Windows",
      cantidad: 1, precio_unitario: 25000,
    })

    let llamadasAServiciosOrden = 0
    vi.mocked(
      (await import("@/lib/supabase")).supabaseAdmin.from
    ).mockImplementation((tabla: string) => {
      if (tabla === "ordenes_servicio") return ordenChain as any
      if (tabla === "servicios_orden") {
        llamadasAServiciosOrden += 1
        return (llamadasAServiciosOrden === 1 ? lineasChain : insertChain) as any
      }
      return createChainMock(null) as any
    })

    const res = await POST(
      createPostRequest({ tipo: "manual", nombre: "Instalacion de Windows", cantidad: 1, precioUnitario: 25000 }),
      params("ord-1")
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.costoFinalActualizado).toBe(true)
    expect(body.sumaServicios).toBe(25000)
    expect(ordenChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ costo_final: 25000 })
    )
  })

  it("no toca costo_final si la orden ya tiene cobros", async () => {
    const ordenChain = createChainMock({
      id: "ord-1", costo_final: 20000, total_cobrado: 10000, organization_id: "org-1",
    })
    const lineasChain = createChainMock([])
    const insertChain = createChainMock({
      id: "lin-1", servicio_id: null, nombre: "Extra", cantidad: 1, precio_unitario: 5000,
    })

    let n = 0
    vi.mocked(
      (await import("@/lib/supabase")).supabaseAdmin.from
    ).mockImplementation((tabla: string) => {
      if (tabla === "ordenes_servicio") return ordenChain as any
      if (tabla === "servicios_orden") { n += 1; return (n === 1 ? lineasChain : insertChain) as any }
      return createChainMock(null) as any
    })

    const res = await POST(
      createPostRequest({ tipo: "manual", nombre: "Extra", cantidad: 1, precioUnitario: 5000 }),
      params("ord-1")
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.costoFinalActualizado).toBe(false)
    expect(ordenChain.update).not.toHaveBeenCalled()
  })

  it("devuelve 404 si la orden es de otra organizacion", async () => {
    mockSupabaseFrom({
      ordenes_servicio: createChainMock(null, { message: "not found" }),
    })

    const res = await POST(
      createPostRequest({ tipo: "manual", nombre: "X", cantidad: 1, precioUnitario: 1 }),
      params("ord-ajena")
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(404)
  })

  it("rechaza cantidad cero", async () => {
    mockSupabaseFrom({
      ordenes_servicio: createChainMock({
        id: "ord-1", costo_final: null, total_cobrado: 0, organization_id: "org-1",
      }),
    })

    const res = await POST(
      createPostRequest({ tipo: "manual", nombre: "X", cantidad: 0, precioUnitario: 100 }),
      params("ord-1")
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
  })
})
