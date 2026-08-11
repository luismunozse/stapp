import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/plan-limits", () => ({
  enforcePlanLimit: vi.fn().mockResolvedValue(null),
}))

import { POST } from "@/app/api/clientes/route"
import { PUT } from "@/app/api/clientes/[id]/route"

function createPutRequest(body: any, url = "http://localhost:3000/api/clientes/c1") {
  return new Request(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe("POST /api/clientes — tier ADMIN-only", () => {
  beforeEach(() => vi.clearAllMocks())

  it("ADMIN puede crear un cliente MAYORISTA con descuentoPct", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const chain = createChainMock({
      id: "c-new",
      nombre: "Mayorista SA",
      telefono: "123",
      tipo_precio: "MAYORISTA",
      descuento_pct: "15.00",
      organization_id: "org-1",
    })
    mockSupabaseFrom({ clientes: chain })

    const response = await POST(
      createPostRequest({ nombre: "Mayorista SA", telefono: "123", tipoPrecio: "MAYORISTA", descuentoPct: 15 })
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(201)
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ tipo_precio: "MAYORISTA", descuento_pct: 15 })
    )
  })

  it("un VENDEDOR recibe 403 al intentar setear el tier, y no crea el cliente", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    const chain = createChainMock({ id: "c-new" })
    mockSupabaseFrom({ clientes: chain })

    const response = await POST(
      createPostRequest({ nombre: "Test", telefono: "123", tipoPrecio: "MAYORISTA", descuentoPct: 15 })
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(403)
    expect(body.error).toContain("administrador")
    expect(chain.insert).not.toHaveBeenCalled()
  })

  it("un VENDEDOR puede seguir creando clientes sin tocar los campos de tier (sin regresión)", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    const chain = createChainMock({ id: "c-new", nombre: "Test", telefono: "123" })
    mockSupabaseFrom({ clientes: chain })

    const response = await POST(createPostRequest({ nombre: "Test", telefono: "123" }))
    const { status } = await parseResponse(response)

    expect(status).toBe(201)
    expect(chain.insert).toHaveBeenCalledWith(
      expect.not.objectContaining({ tipo_precio: expect.anything() })
    )
  })

  it("MINORISTA con descuentoPct enviado se guarda con descuento_pct: null (coerción silenciosa)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const chain = createChainMock({ id: "c-new", tipo_precio: "MINORISTA", descuento_pct: null })
    mockSupabaseFrom({ clientes: chain })

    await POST(
      createPostRequest({ nombre: "Test", telefono: "123", tipoPrecio: "MINORISTA", descuentoPct: 15 })
    )

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ tipo_precio: "MINORISTA", descuento_pct: null })
    )
  })

  it("descuentoPct fuera de [0,100] devuelve 400", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const response = await POST(
      createPostRequest({ nombre: "Test", telefono: "123", tipoPrecio: "MAYORISTA", descuentoPct: 150 })
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(400)
  })

  it("MAYORISTA sin descuentoPct devuelve 400 (estado inválido)", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const response = await POST(
      createPostRequest({ nombre: "Test", telefono: "123", tipoPrecio: "MAYORISTA" })
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(400)
  })
})

describe("PUT /api/clientes/[id] — tier ADMIN-only", () => {
  beforeEach(() => vi.clearAllMocks())

  it("ADMIN puede actualizar tipoPrecio/descuentoPct", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const chain = createChainMock({ id: "c1", tipo_precio: "MAYORISTA", descuento_pct: "20.00" })
    mockSupabaseFrom({ clientes: chain })

    const response = await PUT(
      createPutRequest({ tipoPrecio: "MAYORISTA", descuentoPct: 20 }),
      createParams("c1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ tipo_precio: "MAYORISTA", descuento_pct: 20 })
    )
  })

  it("un TECNICO recibe 403 al intentar cambiar el tier, sin actualizar nada", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    const chain = createChainMock({ id: "c1" })
    mockSupabaseFrom({ clientes: chain })

    const response = await PUT(
      createPutRequest({ tipoPrecio: "MAYORISTA", descuentoPct: 20 }),
      createParams("c1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(403)
    expect(body.error).toContain("administrador")
    expect(chain.update).not.toHaveBeenCalled()
  })

  it("un VENDEDOR puede seguir editando otros campos sin tocar el tier (sin regresión)", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    const chain = createChainMock({ id: "c1", nombre: "Nuevo nombre" })
    mockSupabaseFrom({ clientes: chain })

    const response = await PUT(createPutRequest({ nombre: "Nuevo nombre" }), createParams("c1"))
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(chain.update).toHaveBeenCalledWith(
      expect.not.objectContaining({ tipo_precio: expect.anything() })
    )
  })

  it("al pasar a MINORISTA, descuento_pct se anula en el mismo update", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const chain = createChainMock({ id: "c1", tipo_precio: "MINORISTA", descuento_pct: null })
    mockSupabaseFrom({ clientes: chain })

    await PUT(createPutRequest({ tipoPrecio: "MINORISTA" }), createParams("c1"))

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ tipo_precio: "MINORISTA", descuento_pct: null })
    )
  })
})
