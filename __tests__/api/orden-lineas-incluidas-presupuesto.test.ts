/**
 * Migración 421: una orden con presupuesto (cotización vigente) puede tener
 * servicios y repuestos que ya están dentro de ese presupuesto o que suman
 * aparte al cobro. La marca viaja en el alta y se cambia con PATCH.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createPostRequest, parseResponse } from "./helpers"

import { POST as postServicio, PATCH as patchServicio } from "@/app/api/ordenes/[id]/servicios/route"
import { POST as postRepuesto, PATCH as patchRepuesto } from "@/app/api/ordenes/[id]/repuestos/route"

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const patch = (url: string, body?: unknown) =>
  new Request(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const ordenEnAlcance = () => createChainMock({ id: "ord-1", sucursal_id: "suc-1", tecnico_id: "tec-1" })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(supabaseAdmin.rpc).mockReset()
  mockAuthSuccess({ organizationId: "org-1", role: "ADMIN", userId: "adm-1", sucursalId: "suc-1" })
})

describe("servicios", () => {
  it("el alta manda la marca al RPC", async () => {
    mockSupabaseFrom({ ordenes_servicio: ordenEnAlcance() })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { success: true, id: "l1", nombre: "FRP", cantidad: 1, precio_unitario: 25000, incluido_en_presupuesto: true },
      error: null,
    } as any)

    const res = await postServicio(
      createPostRequest({ tipo: "manual", nombre: "FRP", cantidad: 1, precioUnitario: 25000, incluidoEnPresupuesto: true }),
      params("ord-1")
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "agregar_servicio_orden",
      expect.objectContaining({ p_incluido_en_presupuesto: true })
    )
    expect(body.servicio.incluidoEnPresupuesto).toBe(true)
  })

  it("sin la marca, el alta suma al cobro (default false)", async () => {
    mockSupabaseFrom({ ordenes_servicio: ordenEnAlcance() })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { success: true, id: "l1" }, error: null } as any)

    await postServicio(createPostRequest({ tipo: "manual", nombre: "FRP", cantidad: 1, precioUnitario: 1 }), params("ord-1"))

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "agregar_servicio_orden",
      expect.objectContaining({ p_incluido_en_presupuesto: false })
    )
  })

  it("PATCH con servicioOrdenId cambia la marca por su RPC (no aplica el total)", async () => {
    mockSupabaseFrom({ ordenes_servicio: ordenEnAlcance() })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { success: true, campoSincronizado: "costo_final", montoActualizado: true, sumaLineas: 60000 },
      error: null,
    } as any)

    const res = await patchServicio(
      patch("http://localhost:3000/api/ordenes/ord-1/servicios", { servicioOrdenId: "l1", incluidoEnPresupuesto: false }),
      params("ord-1")
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.montoActualizado).toBe(true)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("marcar_servicio_incluido_presupuesto", {
      p_orden_id: "ord-1",
      p_organization_id: "org-1",
      p_servicio_orden_id: "l1",
      p_incluido: false,
    })
    expect(supabaseAdmin.rpc).not.toHaveBeenCalledWith("aplicar_monto_servicios_orden", expect.anything())
  })

  it("PATCH sin cuerpo sigue siendo 'Aplicar al total'", async () => {
    mockSupabaseFrom({ ordenes_servicio: ordenEnAlcance() })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { success: true, campoSincronizado: "costo_final", monto: 60000 },
      error: null,
    } as any)

    const res = await patchServicio(patch("http://localhost:3000/api/ordenes/ord-1/servicios"), params("ord-1"))

    expect(res.status).toBe(200)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("aplicar_monto_servicios_orden", expect.anything())
  })

  it("PATCH con la marca mal formada devuelve 400 sin tocar nada", async () => {
    mockSupabaseFrom({ ordenes_servicio: ordenEnAlcance() })
    const res = await patchServicio(
      patch("http://localhost:3000/api/ordenes/ord-1/servicios", { servicioOrdenId: "l1", incluidoEnPresupuesto: "si" }),
      params("ord-1")
    )
    expect(res.status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })
})

describe("repuestos", () => {
  it("el alta manual guarda la marca en la fila", async () => {
    const repuestos = createChainMock(null)
    mockSupabaseFrom({ ordenes_servicio: ordenEnAlcance(), repuestos_orden: repuestos })

    const res = await postRepuesto(
      createPostRequest({ tipo: "manual", nombre: "Pin", cantidad: 1, precioUnitario: 7000, precioVentaUnitario: 35000, incluidoEnPresupuesto: true }),
      params("ord-1")
    )

    expect(res.status).toBe(201)
    expect(repuestos.insert).toHaveBeenCalledWith(expect.objectContaining({ incluido_en_presupuesto: true }))
  })

  it("el alta del inventario marca la fila que creó el RPC de stock", async () => {
    const repuestos = createChainMock(null)
    mockSupabaseFrom({
      ordenes_servicio: ordenEnAlcance(),
      inventario: createChainMock({ id: "inv-1", moneda: null }),
      repuestos_orden: repuestos,
    })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { success: true, id: "rep-9" }, error: null } as any)

    const res = await postRepuesto(
      createPostRequest({ tipo: "inventario", inventarioId: "inv-1", cantidad: 1, incluidoEnPresupuesto: true }),
      params("ord-1")
    )

    expect(res.status).toBe(201)
    expect(repuestos.update).toHaveBeenCalledWith({ incluido_en_presupuesto: true })
    expect(repuestos.eq).toHaveBeenCalledWith("id", "rep-9")
  })

  it("el alta del inventario sin marca no hace un UPDATE de más", async () => {
    const repuestos = createChainMock(null)
    mockSupabaseFrom({
      ordenes_servicio: ordenEnAlcance(),
      inventario: createChainMock({ id: "inv-1", moneda: null }),
      repuestos_orden: repuestos,
    })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { success: true, id: "rep-9" }, error: null } as any)

    await postRepuesto(createPostRequest({ tipo: "inventario", inventarioId: "inv-1", cantidad: 1 }), params("ord-1"))

    expect(repuestos.update).not.toHaveBeenCalled()
  })

  it("PATCH con incluidoEnPresupuesto cambia la marca y no toca el stock", async () => {
    const repuestos = createChainMock({ id: "rep-1", orden_id: "ord-1" })
    mockSupabaseFrom({ ordenes_servicio: ordenEnAlcance(), repuestos_orden: repuestos })

    const res = await patchRepuesto(
      patch("http://localhost:3000/api/ordenes/ord-1/repuestos?repuestoId=rep-1", { incluidoEnPresupuesto: false }),
      params("ord-1")
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.incluidoEnPresupuesto).toBe(false)
    expect(repuestos.update).toHaveBeenCalledWith({ incluido_en_presupuesto: false })
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("PATCH de un repuesto de otra orden devuelve 404", async () => {
    mockSupabaseFrom({
      ordenes_servicio: ordenEnAlcance(),
      repuestos_orden: createChainMock({ id: "rep-1", orden_id: "otra" }),
    })
    const res = await patchRepuesto(
      patch("http://localhost:3000/api/ordenes/ord-1/repuestos?repuestoId=rep-1", { incluidoEnPresupuesto: true }),
      params("ord-1")
    )
    expect(res.status).toBe(404)
  })
})
