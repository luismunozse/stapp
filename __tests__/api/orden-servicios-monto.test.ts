import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, createPostRequest, parseResponse } from "./helpers"

import { POST, PATCH } from "@/app/api/ordenes/[id]/servicios/route"

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

function mockRpc(data: any) {
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data, error: null } as any)
}

/**
 * La decisión de qué monto mover vive en el RPC (es donde está el lock). La
 * ruta solo relaya el veredicto: estos tests fijan ese contrato.
 */
describe("POST /api/ordenes/[id]/servicios — monto sincronizado", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ organizationId: "org-1", role: "TECNICO" })
  })

  it("relaya que el RPC movió el presupuesto", async () => {
    mockRpc({
      success: true,
      id: "lin-1",
      servicio_id: null,
      nombre: "Diagnóstico",
      cantidad: 1,
      precio_unitario: 9000,
      campoSincronizado: "presupuesto",
      montoActualizado: true,
      costoFinalActualizado: false,
      sumaServicios: 9000,
    })

    const res = await POST(
      createPostRequest({ tipo: "manual", nombre: "Diagnóstico", cantidad: 1, precioUnitario: 9000 }),
      params("ord-1")
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.campoSincronizado).toBe("presupuesto")
    expect(body.montoActualizado).toBe(true)
    expect(body.costoFinalActualizado).toBe(false)
  })

  it("relaya que el RPC no movió nada", async () => {
    mockRpc({
      success: true,
      id: "lin-2",
      servicio_id: null,
      nombre: "Limpieza",
      cantidad: 1,
      precio_unitario: 5000,
      campoSincronizado: null,
      montoActualizado: false,
      costoFinalActualizado: false,
      sumaServicios: 5000,
    })

    const res = await POST(
      createPostRequest({ tipo: "manual", nombre: "Limpieza", cantidad: 1, precioUnitario: 5000 }),
      params("ord-1")
    )
    const { body } = await parseResponse(res)

    expect(body.campoSincronizado).toBeNull()
    expect(body.montoActualizado).toBe(false)
  })
})

describe("PATCH /api/ordenes/[id]/servicios — aplicar el total", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ organizationId: "org-1", role: "TECNICO" })
  })

  it("aplica la suma al monto vivo y dice cuál movió", async () => {
    mockRpc({ success: true, campoSincronizado: "costo_final", monto: 33000 })

    const res = await PATCH(createPostRequest({}), params("ord-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.campoSincronizado).toBe("costo_final")
    expect(body.monto).toBe(33000)
  })

  it("usa el RPC dedicado, no el PUT de la orden: aplicar no debe notificar al cliente", async () => {
    mockRpc({ success: true, campoSincronizado: "presupuesto", monto: 12000 })

    await PATCH(createPostRequest({}), params("ord-1"))

    expect(vi.mocked(supabaseAdmin.rpc)).toHaveBeenCalledWith("aplicar_monto_servicios_orden", {
      p_orden_id: "ord-1",
      p_organization_id: "org-1",
    })
  })

  it("devuelve 400 cuando el RPC rechaza dejar el cobro al descubierto", async () => {
    mockRpc({ error: "El total de servicios es menor a lo ya cobrado en esta orden" })

    const res = await PATCH(createPostRequest({}), params("ord-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toContain("menor a lo ya cobrado")
  })
})
