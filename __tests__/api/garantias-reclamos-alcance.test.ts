/**
 * POST /api/garantias/[id]/reclamos follows the branch scope of the warranty's order.
 * (PUT is ADMIN-only and unchanged.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createPostRequest, parseResponse } from "./helpers"

import { POST, PUT } from "@/app/api/garantias/[id]/reclamos/route"

const S1 = "sucursal-1"
const S2 = "sucursal-2"
const U1 = "user-1"
const ctx = { params: Promise.resolve({ id: "gar-1" }) }

function garantia(sucursal_id: string, tecnico_id: string | null = null) {
  return {
    id: "gar-1",
    estado: "ACTIVA",
    fecha_vencimiento: new Date(Date.now() + 86400000 * 10).toISOString(),
    ordenes_servicio: { organization_id: "org-1", sucursal_id, tecnico_id },
  }
}

function montar(g: any) {
  const garantias = createChainMock(g)
  const reclamos = createChainMock({ id: "rec-1" })
  mockSupabaseFrom({ garantias, reclamos_garantia: reclamos })
  return { garantias, reclamos }
}

describe("POST /api/garantias/[id]/reclamos branch scope", () => {
  beforeEach(() => vi.clearAllMocks())

  it("VENDEDOR on another branch: 404 and nothing written", async () => {
    const { garantias, reclamos } = montar(garantia(S2))
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { status, body } = await parseResponse(await POST(createPostRequest({ descripcion: "x" }), ctx))
    expect(status).toBe(404)
    expect(body.error).toBe("Garantía no encontrada")
    expect(reclamos.insert).not.toHaveBeenCalled()
    expect(garantias.update).not.toHaveBeenCalled()
  })

  it("VENDEDOR on their own branch: created", async () => {
    const { reclamos } = montar(garantia(S1))
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { status } = await parseResponse(await POST(createPostRequest({ descripcion: "x" }), ctx))
    expect(status).toBe(201)
    expect(reclamos.insert).toHaveBeenCalled()
  })

  it("TECNICO assigned to the order in another branch: created", async () => {
    montar(garantia(S2, U1))
    mockAuthSuccess({ role: "TECNICO", userId: U1, sucursalId: S1 })
    const { status } = await parseResponse(await POST(createPostRequest({ descripcion: "x" }), ctx))
    expect(status).toBe(201)
  })

  it("TECNICO not assigned, other branch: 404", async () => {
    const { reclamos } = montar(garantia(S2, "someone-else"))
    mockAuthSuccess({ role: "TECNICO", userId: U1, sucursalId: S1 })
    const { status } = await parseResponse(await POST(createPostRequest({ descripcion: "x" }), ctx))
    expect(status).toBe(404)
    expect(reclamos.insert).not.toHaveBeenCalled()
  })

  it("ADMIN: unchanged, any branch", async () => {
    montar(garantia(S2))
    mockAuthSuccess({ role: "ADMIN" })
    const { status } = await parseResponse(await POST(createPostRequest({ descripcion: "x" }), ctx))
    expect(status).toBe(201)
  })

  it("PUT stays ADMIN-only for non-admins", async () => {
    montar(garantia(S1))
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { status } = await parseResponse(await PUT(createPostRequest({ estado: "RESUELTO" }), ctx))
    expect(status).toBe(403)
  })
})
