/**
 * Bitácora de avances de una orden: se guarda en orden_eventos (tipo AVANCE)
 * con el estado de la orden y si es visible para el cliente.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createPostRequest, parseResponse } from "./helpers"

import { GET, POST } from "@/app/api/ordenes/[id]/avances/route"
import { DELETE } from "@/app/api/ordenes/[id]/avances/[avanceId]/route"

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const ordenEnAlcance = () => createChainMock({ id: "ord-1", estado: "EN_REPARACION", sucursal_id: "suc-1", tecnico_id: "tec-1" })

const fila = {
  id: "ev-1",
  descripcion: "Se cambió el conector",
  estado_nuevo: "EN_REPARACION",
  metadata: { visible_cliente: true },
  created_at: "2026-11-11T12:00:00Z",
  created_by: "tec-1",
  users: { nombre: "Tecnico" },
}

describe("POST /api/ordenes/[id]/avances", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ organizationId: "org-1", role: "TECNICO", userId: "tec-1", sucursalId: "suc-1" })
  })

  it("guarda el avance con el estado actual de la orden y la visibilidad", async () => {
    const eventos = createChainMock(fila)
    mockSupabaseFrom({ ordenes_servicio: ordenEnAlcance(), orden_eventos: eventos })

    const { status, body } = await parseResponse(
      await POST(createPostRequest({ texto: "  Se cambió el conector  ", visibleCliente: true }), params("ord-1"))
    )

    expect(status).toBe(201)
    expect(eventos.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        orden_id: "ord-1",
        organization_id: "org-1",
        tipo: "AVANCE",
        estado_nuevo: "EN_REPARACION",
        descripcion: "Se cambió el conector",
        metadata: { visible_cliente: true },
        created_by: "tec-1",
      })
    )
    expect(body).toEqual(expect.objectContaining({ id: "ev-1", visibleCliente: true, autor: "Tecnico" }))
  })

  it("un texto vacío es 400 y no inserta", async () => {
    const eventos = createChainMock(fila)
    mockSupabaseFrom({ ordenes_servicio: ordenEnAlcance(), orden_eventos: eventos })

    const { status } = await parseResponse(await POST(createPostRequest({ texto: "   " }), params("ord-1")))

    expect(status).toBe(400)
    expect(eventos.insert).not.toHaveBeenCalled()
  })

  it("una orden de otra sucursal es 404 y no inserta", async () => {
    const eventos = createChainMock(fila)
    mockSupabaseFrom({
      ordenes_servicio: createChainMock({ id: "ord-1", estado: "EN_REPARACION", sucursal_id: "suc-2", tecnico_id: "otro" }),
      orden_eventos: eventos,
    })

    const { status } = await parseResponse(await POST(createPostRequest({ texto: "x" }), params("ord-1")))

    expect(status).toBe(404)
    expect(eventos.insert).not.toHaveBeenCalled()
  })
})

describe("GET /api/ordenes/[id]/avances", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ organizationId: "org-1", role: "ADMIN", userId: "adm-1" })
  })

  it("lista solo eventos AVANCE de la orden", async () => {
    const eventos = createChainMock([fila, { ...fila, id: "ev-2", metadata: { visible_cliente: false } }])
    mockSupabaseFrom({ ordenes_servicio: ordenEnAlcance(), orden_eventos: eventos })

    const { status, body } = await parseResponse(await GET(new Request("http://localhost/x"), params("ord-1")))

    expect(status).toBe(200)
    expect(eventos.eq).toHaveBeenCalledWith("tipo", "AVANCE")
    expect(body.map((a: any) => a.visibleCliente)).toEqual([true, false])
  })
})

describe("DELETE /api/ordenes/[id]/avances/[avanceId]", () => {
  const del = (avanceId: string) =>
    DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ id: "ord-1", avanceId }) })

  beforeEach(() => vi.clearAllMocks())

  it("quien lo escribió lo puede borrar", async () => {
    mockAuthSuccess({ organizationId: "org-1", role: "TECNICO", userId: "tec-1", sucursalId: "suc-1" })
    const eventos = createChainMock({ id: "ev-1", created_by: "tec-1" })
    mockSupabaseFrom({ ordenes_servicio: ordenEnAlcance(), orden_eventos: eventos })

    const { status } = await parseResponse(await del("ev-1"))

    expect(status).toBe(200)
    expect(eventos.delete).toHaveBeenCalled()
    expect(eventos.eq).toHaveBeenCalledWith("tipo", "AVANCE")
  })

  it("otro técnico no puede borrar un avance ajeno", async () => {
    mockAuthSuccess({ organizationId: "org-1", role: "TECNICO", userId: "tec-1", sucursalId: "suc-1" })
    const eventos = createChainMock({ id: "ev-1", created_by: "tec-2" })
    mockSupabaseFrom({ ordenes_servicio: ordenEnAlcance(), orden_eventos: eventos })

    const { status } = await parseResponse(await del("ev-1"))

    expect(status).toBe(403)
    expect(eventos.delete).not.toHaveBeenCalled()
  })

  it("un ADMIN puede borrar cualquiera", async () => {
    mockAuthSuccess({ organizationId: "org-1", role: "ADMIN", userId: "adm-1" })
    const eventos = createChainMock({ id: "ev-1", created_by: "tec-2" })
    mockSupabaseFrom({ ordenes_servicio: ordenEnAlcance(), orden_eventos: eventos })

    const { status } = await parseResponse(await del("ev-1"))

    expect(status).toBe(200)
    expect(eventos.delete).toHaveBeenCalled()
  })
})
