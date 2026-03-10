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

import { GET, POST, PUT, DELETE } from "@/app/api/clientes/[id]/sectores/route"

function createPutRequest(body: any, url: string = "http://localhost:3000/api/test"): Request {
  return new Request(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function createDeleteRequest(url: string = "http://localhost:3000/api/test"): Request {
  return new Request(url, { method: "DELETE" })
}

const params = Promise.resolve({ id: "cliente-1" })

describe("GET /api/clientes/[id]/sectores", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when not authenticated", async () => {
    mockAuthError()

    const response = await GET(
      createGetRequest("http://localhost:3000/api/clientes/cliente-1/sectores"),
      { params }
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(401)
    expect(body.error).toBe("No autorizado")
  })

  it("returns 404 when client not found", async () => {
    mockAuthSuccess()

    const clienteChain = createChainMock(null, { message: "not found" })
    mockSupabaseFrom({ clientes: clienteChain })

    const response = await GET(
      createGetRequest("http://localhost:3000/api/clientes/cliente-1/sectores"),
      { params }
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(404)
    expect(body.error).toBe("Cliente no encontrado")
  })

  it("returns list of sectors for the client", async () => {
    mockAuthSuccess()

    const mockSectores = [
      { id: "s1", cliente_id: "cliente-1", nombre: "Finanzas", contacto_nombre: "Juan", contacto_telefono: "123", contacto_email: null, activo: true },
      { id: "s2", cliente_id: "cliente-1", nombre: "Contabilidad", contacto_nombre: null, contacto_telefono: null, contacto_email: null, activo: true },
    ]

    const clienteChain = createChainMock({ id: "cliente-1" })
    const sectoresChain = createChainMock(mockSectores)
    // Make sectores chain resolve via .then (no .single())
    sectoresChain.then = (resolve: any) => resolve({ data: mockSectores, error: null })

    mockSupabaseFrom({ clientes: clienteChain, sectores_cliente: sectoresChain })

    const response = await GET(
      createGetRequest("http://localhost:3000/api/clientes/cliente-1/sectores"),
      { params }
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body).toHaveLength(2)
    expect(body[0].nombre).toBe("Finanzas")
    expect(body[0].contactoNombre).toBe("Juan")
    expect(body[1].nombre).toBe("Contabilidad")
  })
})

describe("POST /api/clientes/[id]/sectores", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when not authenticated", async () => {
    mockAuthError()

    const response = await POST(
      createPostRequest({ nombre: "Finanzas" }),
      { params }
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(401)
    expect(body.error).toBe("No autorizado")
  })

  it("returns 400 when client is not EMPRESA", async () => {
    mockAuthSuccess()

    const clienteChain = createChainMock({ id: "cliente-1", tipo_cliente: "INDIVIDUAL" })
    mockSupabaseFrom({ clientes: clienteChain })

    const response = await POST(
      createPostRequest({ nombre: "Finanzas" }),
      { params }
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toContain("EMPRESA")
  })

  it("creates a sector successfully", async () => {
    mockAuthSuccess()

    const newSector = {
      id: "s-new",
      cliente_id: "cliente-1",
      nombre: "Finanzas",
      contacto_nombre: "Juan Perez",
      contacto_telefono: "123456",
      contacto_email: null,
      activo: true,
    }

    const clienteChain = createChainMock({ id: "cliente-1", tipo_cliente: "EMPRESA" })
    const sectoresChain = createChainMock(newSector)
    mockSupabaseFrom({ clientes: clienteChain, sectores_cliente: sectoresChain })

    const response = await POST(
      createPostRequest({
        nombre: "Finanzas",
        contactoNombre: "Juan Perez",
        contactoTelefono: "123456",
      }),
      { params }
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(201)
    expect(body.nombre).toBe("Finanzas")
    expect(body.contactoNombre).toBe("Juan Perez")
    expect(sectoresChain.insert).toHaveBeenCalled()
  })

  it("returns 400 when nombre is missing", async () => {
    mockAuthSuccess()

    const clienteChain = createChainMock({ id: "cliente-1", tipo_cliente: "EMPRESA" })
    mockSupabaseFrom({ clientes: clienteChain })

    const response = await POST(
      createPostRequest({}),
      { params }
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toBeDefined()
  })

  it("returns 400 on duplicate sector name", async () => {
    mockAuthSuccess()

    const clienteChain = createChainMock({ id: "cliente-1", tipo_cliente: "EMPRESA" })
    const sectoresChain = createChainMock(null, { code: "23505", message: "duplicate key" })
    mockSupabaseFrom({ clientes: clienteChain, sectores_cliente: sectoresChain })

    const response = await POST(
      createPostRequest({ nombre: "Finanzas" }),
      { params }
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toContain("Ya existe un sector")
  })
})

describe("PUT /api/clientes/[id]/sectores", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 400 when sectorId is missing", async () => {
    mockAuthSuccess()

    const response = await PUT(
      createPutRequest(
        { nombre: "Nuevo nombre" },
        "http://localhost:3000/api/clientes/cliente-1/sectores"
      ),
      { params }
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toContain("sectorId")
  })

  it("updates a sector successfully", async () => {
    mockAuthSuccess()

    const updatedSector = {
      id: "s1",
      cliente_id: "cliente-1",
      nombre: "Finanzas Actualizado",
      contacto_nombre: null,
      contacto_telefono: null,
      contacto_email: null,
      activo: true,
    }

    const clienteChain = createChainMock({ id: "cliente-1" })
    const sectoresChain = createChainMock(updatedSector)
    mockSupabaseFrom({ clientes: clienteChain, sectores_cliente: sectoresChain })

    const response = await PUT(
      createPutRequest(
        { nombre: "Finanzas Actualizado" },
        "http://localhost:3000/api/clientes/cliente-1/sectores?sectorId=s1"
      ),
      { params }
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body.nombre).toBe("Finanzas Actualizado")
  })
})

describe("DELETE /api/clientes/[id]/sectores", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 400 when sectorId is missing", async () => {
    mockAuthSuccess()

    const response = await DELETE(
      createDeleteRequest("http://localhost:3000/api/clientes/cliente-1/sectores"),
      { params }
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toContain("sectorId")
  })

  it("deletes a sector successfully", async () => {
    mockAuthSuccess()

    const clienteChain = createChainMock({ id: "cliente-1" })
    const sectoresChain = createChainMock(null)
    // delete chain doesn't use .single()
    sectoresChain.then = (resolve: any) => resolve({ data: null, error: null })
    mockSupabaseFrom({ clientes: clienteChain, sectores_cliente: sectoresChain })

    const response = await DELETE(
      createDeleteRequest("http://localhost:3000/api/clientes/cliente-1/sectores?sectorId=s1"),
      { params }
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
  })
})
