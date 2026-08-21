import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  createPostRequest,
  parseResponse,
} from "./helpers"

import { GET, POST } from "@/app/api/servicios/route"

describe("GET /api/servicios", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ organizationId: "org-1", role: "ADMIN" })
  })

  it("devuelve los servicios de la organizacion", async () => {
    const chain = createChainMock([
      {
        id: "srv-1", codigo: "SRV-001", nombre: "Instalacion de Windows",
        descripcion: null, categoria: "Software", precio: 25000,
        duracion_estimada_min: 60, activo: true,
      },
    ])
    mockSupabaseFrom({ servicios: chain })

    const res = await GET(createGetRequest("http://localhost:3000/api/servicios"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.servicios).toHaveLength(1)
    expect(body.servicios[0].nombre).toBe("Instalacion de Windows")
    expect(body.servicios[0].precio).toBe(25000)
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })
})

describe("POST /api/servicios", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("crea un servicio", async () => {
    mockAuthSuccess({ organizationId: "org-1", role: "ADMIN" })
    const chain = createChainMock({
      id: "srv-1", codigo: "SRV-001", nombre: "Instalacion de Windows",
      descripcion: null, categoria: null, precio: 25000,
      duracion_estimada_min: null, activo: true,
    })
    mockSupabaseFrom({ servicios: chain })

    const res = await POST(
      createPostRequest({ codigo: "SRV-001", nombre: "Instalacion de Windows", precio: 25000 })
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.servicio.id).toBe("srv-1")
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ organization_id: "org-1" })
    )
  })

  it("rechaza precio negativo", async () => {
    mockAuthSuccess({ organizationId: "org-1", role: "ADMIN" })
    mockSupabaseFrom({ servicios: createChainMock(null) })

    const res = await POST(
      createPostRequest({ codigo: "SRV-001", nombre: "Test", precio: -1 })
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
  })

  it("devuelve 403 si el usuario no es ADMIN", async () => {
    mockAuthSuccess({ organizationId: "org-1", role: "TECNICO" })
    mockSupabaseFrom({ servicios: createChainMock(null) })

    const res = await POST(
      createPostRequest({ codigo: "SRV-001", nombre: "Test", precio: 100 })
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(403)
  })

  it("traduce el codigo duplicado a un mensaje claro", async () => {
    mockAuthSuccess({ organizationId: "org-1", role: "ADMIN" })
    mockSupabaseFrom({
      servicios: createChainMock(null, { code: "23505", message: "duplicate key" }),
    })

    const res = await POST(
      createPostRequest({ codigo: "SRV-001", nombre: "Test", precio: 100 })
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toContain("código")
  })
})
