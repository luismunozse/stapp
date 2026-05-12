import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

import { GET, POST } from "@/app/api/proveedores/[id]/contactos/route"
import { PUT, DELETE } from "@/app/api/proveedores/[id]/contactos/[contactoId]/route"

function asParams(id: string, contactoId?: string) {
  const params = contactoId ? { id, contactoId } : { id }
  return { params: Promise.resolve(params as any) }
}

function buildPost(body: any) {
  return createPostRequest(body, "http://localhost:3000/api/proveedores/p1/contactos")
}

function buildPut(body: any) {
  return new Request("http://localhost:3000/api/proveedores/p1/contactos/c1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function buildGet() {
  return new Request("http://localhost:3000/api/proveedores/p1/contactos")
}

// ─── GET ──────────────────────────────────────────────
describe("GET /api/proveedores/[id]/contactos", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const res = await GET(buildGet(), asParams("p1"))
    const { status } = await parseResponse(res)
    expect(status).toBe(401)
  })

  it("returns ordered contactos (principal primero)", async () => {
    mockAuthSuccess()
    const rows = [
      { id: "c1", proveedor_id: "p1", nombre: "Ana", principal: true },
      { id: "c2", proveedor_id: "p1", nombre: "Juan", principal: false },
    ]
    const chain = createChainMock(rows)
    mockSupabaseFrom({ proveedor_contactos: chain })

    const res = await GET(buildGet(), asParams("p1"))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body[0].nombre).toBe("Ana")
    expect(body[0].principal).toBe(true)
    expect(chain.order).toHaveBeenCalledWith("principal", { ascending: false })
  })
})

// ─── POST ─────────────────────────────────────────────
describe("POST /api/proveedores/[id]/contactos", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 404 when proveedor missing", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      proveedores: createChainMock(null, { message: "not found" }),
    })
    const res = await POST(buildPost({ nombre: "Ana" }), asParams("missing"))
    const { status } = await parseResponse(res)
    expect(status).toBe(404)
  })

  it("returns 400 when nombre missing", async () => {
    mockAuthSuccess()
    const provChain = createChainMock({ id: "p1" })
    mockSupabaseFrom({ proveedores: provChain })
    const res = await POST(buildPost({}), asParams("p1"))
    const { status } = await parseResponse(res)
    expect(status).toBe(400)
  })

  it("returns 400 when whatsapp invalid", async () => {
    mockAuthSuccess()
    const provChain = createChainMock({ id: "p1" })
    mockSupabaseFrom({ proveedores: provChain })
    const res = await POST(buildPost({ nombre: "Ana", whatsapp: "abc" }), asParams("p1"))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(400)
    expect(body.error).toMatch(/whatsapp/i)
  })

  it("creates contacto and strips whatsapp digits", async () => {
    mockAuthSuccess()
    const provChain = createChainMock({ id: "p1" })
    const contactoChain = createChainMock({
      id: "c1",
      proveedor_id: "p1",
      nombre: "Ana",
      whatsapp: "5491111111111",
      principal: false,
    })
    mockSupabaseFrom({
      proveedores: provChain,
      proveedor_contactos: contactoChain,
    })

    const res = await POST(
      buildPost({ nombre: "Ana", whatsapp: "+54 9 11 1111-1111" }),
      asParams("p1")
    )
    const { status } = await parseResponse(res)
    expect(status).toBe(201)
    expect(contactoChain.insert).toHaveBeenCalled()
    const insertArg = contactoChain.insert.mock.calls[0][0]
    expect(insertArg.whatsapp).toBe("5491111111111")
  })

  it("clears existing principal when new contacto is principal", async () => {
    mockAuthSuccess()
    const provChain = createChainMock({ id: "p1" })
    const contactoChain = createChainMock({
      id: "c2",
      proveedor_id: "p1",
      nombre: "Nuevo",
      principal: true,
    })
    mockSupabaseFrom({
      proveedores: provChain,
      proveedor_contactos: contactoChain,
    })

    await POST(buildPost({ nombre: "Nuevo", principal: true }), asParams("p1"))

    // El primer .update() debe haber desmarcado principal en otros antes del insert
    expect(contactoChain.update).toHaveBeenCalledWith({ principal: false })
  })
})

// ─── PUT ──────────────────────────────────────────────
describe("PUT /api/proveedores/[id]/contactos/[contactoId]", () => {
  beforeEach(() => vi.clearAllMocks())

  it("rejects invalid whatsapp", async () => {
    mockAuthSuccess()
    const chain = createChainMock({ id: "c1" })
    mockSupabaseFrom({ proveedor_contactos: chain })
    const res = await PUT(buildPut({ whatsapp: "xx" }), asParams("p1", "c1"))
    const { status } = await parseResponse(res)
    expect(status).toBe(400)
  })

  it("updates contacto and strips whatsapp", async () => {
    mockAuthSuccess()
    const chain = createChainMock({
      id: "c1",
      proveedor_id: "p1",
      nombre: "Ana",
      whatsapp: "5491111111111",
    })
    mockSupabaseFrom({ proveedor_contactos: chain })

    const res = await PUT(buildPut({ whatsapp: "+54 9 11 1111-1111" }), asParams("p1", "c1"))
    const { status } = await parseResponse(res)
    expect(status).toBe(200)
    const updArg = chain.update.mock.calls[0][0]
    expect(updArg.whatsapp).toBe("5491111111111")
  })

  it("returns 404 when contacto missing", async () => {
    mockAuthSuccess()
    const chain = createChainMock(null, { message: "not found" })
    mockSupabaseFrom({ proveedor_contactos: chain })
    const res = await PUT(buildPut({ nombre: "Ana" }), asParams("p1", "missing"))
    const { status } = await parseResponse(res)
    expect(status).toBe(404)
  })
})

// ─── DELETE ───────────────────────────────────────────
describe("DELETE /api/proveedores/[id]/contactos/[contactoId]", () => {
  beforeEach(() => vi.clearAllMocks())

  it("deletes contacto", async () => {
    mockAuthSuccess()
    const chain = createChainMock(null, null)
    mockSupabaseFrom({ proveedor_contactos: chain })

    const req = new Request("http://localhost:3000/api/proveedores/p1/contactos/c1", { method: "DELETE" })
    const res = await DELETE(req, asParams("p1", "c1"))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(chain.delete).toHaveBeenCalled()
  })
})
