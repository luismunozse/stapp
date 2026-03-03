import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/plan-limits", () => ({
  enforcePlanLimit: vi.fn().mockResolvedValue(null),
}))

import { enforcePlanLimit } from "@/lib/plan-limits"
import { GET, POST } from "@/app/api/clientes/route"

describe("GET /api/clientes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when not authenticated", async () => {
    mockAuthError()

    const response = await GET(createGetRequest("http://localhost:3000/api/clientes"))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(401)
    expect(body.error).toBe("No autorizado")
  })

  it("returns list of clients for the organization", async () => {
    mockAuthSuccess()

    const mockClientes = [
      { id: "c1", nombre: "Juan Perez", telefono: "1234567890", email: "juan@test.com", direccion: null, dni: null, created_at: "2024-01-01" },
      { id: "c2", nombre: "Maria Lopez", telefono: "0987654321", email: null, direccion: "Av. 123", dni: "12345678", created_at: "2024-01-02" },
    ]

    const chain = createChainMock(mockClientes, null, 2)
    mockSupabaseFrom({ clientes: chain })

    const response = await GET(createGetRequest("http://localhost:3000/api/clientes"))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body.data).toHaveLength(2)
    expect(body.data[0].nombre).toBe("Juan Perez")
    expect(body.data[1].nombre).toBe("Maria Lopez")
    expect(body.total).toBe(2)
    expect(body.page).toBe(1)
  })

  it("applies search filter when provided", async () => {
    mockAuthSuccess()

    const chain = createChainMock([])
    mockSupabaseFrom({ clientes: chain })

    await GET(createGetRequest("http://localhost:3000/api/clientes?search=juan"))

    expect(chain.or).toHaveBeenCalled()
  })

  it("sets no-cache headers", async () => {
    mockAuthSuccess()
    const chain = createChainMock([])
    mockSupabaseFrom({ clientes: chain })

    const response = await GET(createGetRequest("http://localhost:3000/api/clientes"))

    expect(response.headers.get("Cache-Control")).toBe("no-store, no-cache, must-revalidate")
  })

  it("returns 500 on database error", async () => {
    mockAuthSuccess()

    const chain = createChainMock(null, { message: "DB connection failed" })
    chain.then = (resolve: any) => resolve({ data: null, error: { message: "DB connection failed" } })
    mockSupabaseFrom({ clientes: chain })

    const response = await GET(createGetRequest("http://localhost:3000/api/clientes"))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(500)
    expect(body.error).toBe("Error al obtener clientes")
  })
})

describe("POST /api/clientes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when not authenticated", async () => {
    mockAuthError()

    const response = await POST(createPostRequest({ nombre: "Test" }))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(401)
    expect(body.error).toBe("No autorizado")
  })

  it("creates a client successfully", async () => {
    mockAuthSuccess()

    const newCliente = {
      id: "c-new",
      nombre: "Carlos Garcia",
      telefono: "1122334455",
      email: "carlos@test.com",
      direccion: null,
      dni: null,
      organization_id: "org-1",
    }

    const chain = createChainMock(newCliente)
    mockSupabaseFrom({ clientes: chain })

    const response = await POST(
      createPostRequest({
        nombre: "Carlos Garcia",
        telefono: "1122334455",
        email: "carlos@test.com",
      })
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(201)
    expect(body.nombre).toBe("Carlos Garcia")
    expect(chain.insert).toHaveBeenCalled()
  })

  it("returns 400 when nombre is missing", async () => {
    mockAuthSuccess()

    const response = await POST(
      createPostRequest({ telefono: "1122334455" })
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toBeDefined()
  })

  it("returns 400 when telefono is missing", async () => {
    mockAuthSuccess()

    const response = await POST(
      createPostRequest({ nombre: "Test User" })
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toBeDefined()
  })

  it("returns 400 on duplicate phone", async () => {
    mockAuthSuccess()

    const chain = createChainMock(null, { code: "23505", message: "duplicate key" })
    mockSupabaseFrom({ clientes: chain })

    const response = await POST(
      createPostRequest({ nombre: "Test User", telefono: "1111111111" })
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toContain("Ya existe un cliente")
  })

  it("enforces plan limits", async () => {
    mockAuthSuccess()

    vi.mocked(enforcePlanLimit).mockResolvedValueOnce(
      NextResponse.json({ error: "Límite alcanzado" }, { status: 403 }) as any
    )

    const response = await POST(
      createPostRequest({ nombre: "Test", telefono: "123" })
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(403)
    expect(body.error).toContain("Límite")
  })
})
