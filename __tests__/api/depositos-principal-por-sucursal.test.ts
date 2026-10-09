/**
 * El deposito principal es POR SUCURSAL (migracion 221). Marcar un principal en
 * una sucursal no puede despromover el de las demas: la org quedaria sin
 * principal en su sucursal central y las RPCs sin deposito explicito fallan.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse, createPostRequest } from "./helpers"

vi.mock("@/lib/sucursal", () => ({
  sucursalParaEscritura: vi.fn(),
}))

import { sucursalParaEscritura } from "@/lib/sucursal"
import { supabaseAdmin } from "@/lib/supabase"
import { POST } from "@/app/api/depositos/route"
import { PUT } from "@/app/api/depositos/[id]/route"

const rowDb = {
  id: "dep-9",
  nombre: "Norte",
  codigo: null,
  direccion: null,
  notas: null,
  principal: false,
  activo: true,
  sucursal_id: "suc-B",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
}

describe("POST /api/depositos — principal por sucursal", () => {
  beforeEach(() => vi.clearAllMocks())

  it("el demote del principal anterior se acota a la sucursal del deposito nuevo", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-B")
    const depositos = createChainMock(rowDb)
    mockSupabaseFrom({ depositos })

    const res = await POST(createPostRequest({ nombre: "Norte", principal: true }))

    expect(res.status).toBe(201)
    expect(depositos.update).toHaveBeenCalledWith({ principal: false })
    expect(depositos.eq).toHaveBeenCalledWith("sucursal_id", "suc-B")
  })

  it("un choque contra el indice de principal no se reporta como nombre repetido", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-B")
    mockSupabaseFrom({
      depositos: createChainMock(null, {
        code: "23505",
        message: 'duplicate key value violates unique constraint "depositos_org_sucursal_principal_unique"',
      }),
    })

    const { status, body } = await parseResponse(
      await POST(createPostRequest({ nombre: "Norte", principal: true }))
    )

    expect(status).toBe(400)
    expect(body.error).toMatch(/principal/i)
    expect(body.error).not.toMatch(/nombre/i)
  })

  it("un choque de nombre sigue diciendo nombre repetido", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-B")
    mockSupabaseFrom({
      depositos: createChainMock(null, {
        code: "23505",
        message: 'duplicate key value violates unique constraint "depositos_org_nombre_unique"',
      }),
    })

    const { body } = await parseResponse(await POST(createPostRequest({ nombre: "Norte" })))

    expect(body.error).toBe("Ya existe un depósito con ese nombre")
  })
})

describe("PUT /api/depositos/[id] — principal por sucursal", () => {
  beforeEach(() => vi.clearAllMocks())

  it("al promover, el demote se acota a la sucursal del deposito promovido", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const depositos = createChainMock({ ...rowDb, principal: false })
    mockSupabaseFrom({ depositos })

    const res = await PUT(
      new Request("http://localhost:3000/api/depositos/dep-9", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ principal: true }),
      }),
      { params: Promise.resolve({ id: "dep-9" }) }
    )

    expect(res.status).toBe(200)
    expect(depositos.update).toHaveBeenCalledWith({ principal: false })
    expect(depositos.eq).toHaveBeenCalledWith("sucursal_id", "suc-B")
    expect(vi.mocked(supabaseAdmin.from)).toHaveBeenCalledWith("depositos")
  })
})
