import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  createPostRequest,
  parseResponse,
} from "./helpers"

import { GET, POST } from "@/app/api/proveedores/route"
import { PUT, DELETE } from "@/app/api/proveedores/[id]/route"

function asParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

// ─── GET ──────────────────────────────────────────────
describe("GET /api/proveedores", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const res = await GET()
    const { status, body } = await parseResponse(res)
    expect(status).toBe(401)
    expect(body.error).toBe("No autorizado")
  })

  it("returns list of proveedores", async () => {
    mockAuthSuccess()
    const rows = [
      { id: "p1", nombre: "Alpha", activo: true, organization_id: "org-1", created_at: "2026-01-01", updated_at: "2026-01-01" },
      { id: "p2", nombre: "Beta", activo: false, organization_id: "org-1", created_at: "2026-01-02", updated_at: "2026-01-02" },
    ]
    const chain = createChainMock(rows)
    mockSupabaseFrom({ proveedores: chain })

    const res = await GET()
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body).toHaveLength(2)
    expect(body[0].nombre).toBe("Alpha")
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })
})

// ─── POST ─────────────────────────────────────────────
describe("POST /api/proveedores", () => {
  beforeEach(() => vi.clearAllMocks())

  function buildPost(body: any) {
    return createPostRequest(body, "http://localhost:3000/api/proveedores")
  }

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const res = await POST(buildPost({ nombre: "X" }))
    const { status } = await parseResponse(res)
    expect(status).toBe(401)
  })

  it("returns 400 when nombre missing", async () => {
    mockAuthSuccess()
    const res = await POST(buildPost({}))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(400)
    expect(body.error).toBeDefined()
  })

  it("creates a proveedor and strips non-digits from whatsapp", async () => {
    mockAuthSuccess()
    const inserted = {
      id: "p1",
      nombre: "Proveedor X",
      activo: true,
      organization_id: "org-1",
      whatsapp: "5491112345678",
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    }
    const chain = createChainMock(inserted)
    mockSupabaseFrom({ proveedores: chain })

    const res = await POST(
      buildPost({
        nombre: "Proveedor X",
        whatsapp: "+54 9 11 1234-5678",
      })
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.nombre).toBe("Proveedor X")
    expect(chain.insert).toHaveBeenCalled()
    const insertArg = chain.insert.mock.calls[0][0]
    expect(insertArg.whatsapp).toBe("5491112345678")
  })

  it("returns 400 when whatsapp has too few digits", async () => {
    mockAuthSuccess()
    const res = await POST(buildPost({ nombre: "X", whatsapp: "12345" }))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(400)
    expect(body.error).toMatch(/whatsapp/i)
  })

  it("returns 400 for invalid condicionIva enum", async () => {
    mockAuthSuccess()
    const res = await POST(buildPost({ nombre: "X", condicionIva: "INVENTADO" }))
    const { status } = await parseResponse(res)
    expect(status).toBe(400)
  })

  it("returns 400 on duplicate nombre", async () => {
    mockAuthSuccess()
    const chain = createChainMock(null, { code: "23505", message: "duplicate" })
    mockSupabaseFrom({ proveedores: chain })

    const res = await POST(buildPost({ nombre: "Existing" }))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(400)
    expect(body.error).toContain("Ya existe")
  })

  it("persists rating, tags, leadTimeDias, pedidoMinimo", async () => {
    mockAuthSuccess()
    const chain = createChainMock({
      id: "p1", nombre: "X", activo: true, organization_id: "org-1",
      created_at: "2026-01-01", updated_at: "2026-01-01",
    })
    mockSupabaseFrom({ proveedores: chain })

    await POST(buildPost({
      nombre: "X",
      rating: 5,
      tags: ["mayorista", "repuestos"],
      leadTimeDias: 7,
      pedidoMinimo: 10000,
    }))

    const insertArg = chain.insert.mock.calls[0][0]
    expect(insertArg.rating).toBe(5)
    expect(insertArg.tags).toEqual(["mayorista", "repuestos"])
    expect(insertArg.lead_time_dias).toBe(7)
    expect(insertArg.pedido_minimo).toBe(10000)
  })

  it("normaliza tags vacío como null", async () => {
    mockAuthSuccess()
    const chain = createChainMock({
      id: "p1", nombre: "X", activo: true, organization_id: "org-1",
    })
    mockSupabaseFrom({ proveedores: chain })

    await POST(buildPost({ nombre: "X", tags: [] }))
    const insertArg = chain.insert.mock.calls[0][0]
    expect(insertArg.tags).toBeNull()
  })
})

// ─── PUT ──────────────────────────────────────────────
describe("PUT /api/proveedores/[id]", () => {
  beforeEach(() => vi.clearAllMocks())

  function buildPut(body: any) {
    return new Request("http://localhost:3000/api/proveedores/p1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  }

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const res = await PUT(buildPut({ nombre: "Y" }), asParams("p1"))
    const { status } = await parseResponse(res)
    expect(status).toBe(401)
  })

  it("returns 404 when proveedor not found", async () => {
    mockAuthSuccess()
    const chain = createChainMock(null, { message: "not found" })
    mockSupabaseFrom({ proveedores: chain })

    const res = await PUT(buildPut({ nombre: "Y" }), asParams("p1"))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(404)
    expect(body.error).toContain("no encontrado")
  })

  it("updates whatsapp stripping non-digits", async () => {
    mockAuthSuccess()
    // Two phases:
    //  - first .single() returns existence check { id }
    //  - second chain.update().single() returns updated row
    const existsThenUpdate = createChainMock({
      id: "p1",
      nombre: "Updated",
      activo: true,
      organization_id: "org-1",
      whatsapp: "5491111111111",
    })
    mockSupabaseFrom({ proveedores: existsThenUpdate })

    const res = await PUT(buildPut({ whatsapp: "+54 (9) 11 1111-1111" }), asParams("p1"))
    const { status } = await parseResponse(res)
    expect(status).toBe(200)
    expect(existsThenUpdate.update).toHaveBeenCalled()
    const updArg = existsThenUpdate.update.mock.calls[0][0]
    expect(updArg.whatsapp).toBe("5491111111111")
  })

  it("rejects invalid whatsapp", async () => {
    mockAuthSuccess()
    const chain = createChainMock({ id: "p1" })
    mockSupabaseFrom({ proveedores: chain })
    const res = await PUT(buildPut({ whatsapp: "abc" }), asParams("p1"))
    const { status } = await parseResponse(res)
    expect(status).toBe(400)
  })
})

// ─── DELETE ───────────────────────────────────────────
describe("DELETE /api/proveedores/[id]", () => {
  beforeEach(() => vi.clearAllMocks())

  function buildDelete(force = false) {
    const url = `http://localhost:3000/api/proveedores/p1${force ? "?force=1" : ""}`
    return new Request(url, { method: "DELETE" })
  }

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const res = await DELETE(buildDelete(), asParams("p1"))
    const { status } = await parseResponse(res)
    expect(status).toBe(401)
  })

  it("returns 404 when proveedor not found", async () => {
    mockAuthSuccess()
    const chain = createChainMock(null, { message: "not found" })
    mockSupabaseFrom({ proveedores: chain })

    const res = await DELETE(buildDelete(), asParams("p1"))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(404)
    expect(body.error).toContain("no encontrado")
  })

  it("returns 409 when proveedor has references (no force)", async () => {
    mockAuthSuccess()
    // chain.single() returns proveedor (exists check); subsequent count queries return positive counts.
    const provChain = createChainMock({ id: "p1" })
    // For count queries, we'd need to mock .from("inventario") and .from("ordenes_compra")
    // with a head/count select that resolves with { count }.
    const invChain: any = createChainMock(null, null, 3) // count: 3
    invChain.then = (resolve: any) => resolve({ data: null, error: null, count: 3 })
    const ocChain: any = createChainMock(null, null, 0)
    ocChain.then = (resolve: any) => resolve({ data: null, error: null, count: 0 })

    mockSupabaseFrom({
      proveedores: provChain,
      inventario: invChain,
      ordenes_compra: ocChain,
    })

    const res = await DELETE(buildDelete(false), asParams("p1"))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(409)
    expect(body.error).toContain("referencias")
    expect(body.productos).toBe(3)
    expect(body.ordenes).toBe(0)
  })

  it("deletes when has references and force=1", async () => {
    mockAuthSuccess()
    const provChain = createChainMock({ id: "p1" })

    mockSupabaseFrom({ proveedores: provChain })

    const res = await DELETE(buildDelete(true), asParams("p1"))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(provChain.delete).toHaveBeenCalled()
  })

  it("deletes when no references", async () => {
    mockAuthSuccess()
    const provChain = createChainMock({ id: "p1" })

    const invChain: any = createChainMock(null, null, 0)
    invChain.then = (resolve: any) => resolve({ data: null, error: null, count: 0 })
    const ocChain: any = createChainMock(null, null, 0)
    ocChain.then = (resolve: any) => resolve({ data: null, error: null, count: 0 })

    mockSupabaseFrom({
      proveedores: provChain,
      inventario: invChain,
      ordenes_compra: ocChain,
    })

    const res = await DELETE(buildDelete(false), asParams("p1"))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.success).toBe(true)
  })
})
