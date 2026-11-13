import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  createPostRequest,
  parseResponse,
} from "./helpers"

import { supabaseAdmin } from "@/lib/supabase"
import { cargarConfigMoneda } from "@/lib/currency/tipo-cambio.server"
import { resolverConfigMoneda } from "@/lib/currency/config-moneda"
import { GET, POST } from "@/app/api/servicios/route"

vi.mock("@/lib/currency/tipo-cambio.server", () => ({ cargarConfigMoneda: vi.fn() }))

const configUsd = (habilitada: boolean) => ({
  config: { ...resolverConfigMoneda({ multimoneda_habilitada: habilitada, moneda_extranjera: "USD" } as any, "AR"), habilitada },
  fila: null,
})
const filaSrv = (extra: Record<string, unknown> = {}) => ({
  id: "srv-1", codigo: "SRV-001", nombre: "Instalacion", descripcion: null, categoria: null,
  precio: 50, duracion_estimada_min: null, activo: true, moneda: null, ...extra,
})

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

describe("servicios con moneda", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ organizationId: "org-1", role: "ADMIN" })
  })
  const cuerpo = { codigo: "SRV-001", nombre: "Instalacion", precio: 50 }

  it("toDTO incluye la moneda (null si la fila no la tiene)", async () => {
    mockSupabaseFrom({ servicios: createChainMock([filaSrv({ moneda: "USD" }), filaSrv({ id: "s2", moneda: undefined })]) })
    const { body } = await parseResponse(await GET(createGetRequest("http://localhost:3000/api/servicios")))
    expect(body.servicios.map((s: any) => s.moneda)).toEqual(["USD", null])
  })

  it("GET ?moneda=local filtra moneda null y ?moneda=divisa las que no son null", async () => {
    const local = createChainMock([])
    mockSupabaseFrom({ servicios: local })
    await GET(createGetRequest("http://localhost:3000/api/servicios?moneda=local"))
    expect(local.is).toHaveBeenCalledWith("moneda", null)

    const divisa = createChainMock([])
    mockSupabaseFrom({ servicios: divisa })
    await GET(createGetRequest("http://localhost:3000/api/servicios?moneda=divisa"))
    expect(divisa.not).toHaveBeenCalledWith("moneda", "is", null)
  })

  it("POST sin moneda inserta moneda null y no lee la configuración", async () => {
    const chain = createChainMock(filaSrv())
    mockSupabaseFrom({ servicios: chain })
    const { status } = await parseResponse(await POST(createPostRequest(cuerpo)))
    expect(status).toBe(201)
    expect(chain.insert.mock.calls[0][0]).toHaveProperty("moneda", null)
    expect(cargarConfigMoneda).not.toHaveBeenCalled()
  })

  it("POST con USD y la función activa inserta USD", async () => {
    vi.mocked(cargarConfigMoneda).mockResolvedValue(configUsd(true) as any)
    const chain = createChainMock(filaSrv({ moneda: "USD" }))
    mockSupabaseFrom({ servicios: chain })
    const { status, body } = await parseResponse(await POST(createPostRequest({ ...cuerpo, moneda: "USD" })))
    expect(status).toBe(201)
    expect(chain.insert.mock.calls[0][0].moneda).toBe("USD")
    expect(body.servicio.moneda).toBe("USD")
  })

  it("POST con USD y la función apagada es 400 y no inserta", async () => {
    vi.mocked(cargarConfigMoneda).mockResolvedValue(configUsd(false) as any)
    const chain = createChainMock(filaSrv())
    mockSupabaseFrom({ servicios: chain })
    const { status, body } = await parseResponse(await POST(createPostRequest({ ...cuerpo, moneda: "USD" })))
    expect(status).toBe(400)
    expect(body.error).toBe("La moneda extranjera está deshabilitada")
    expect(chain.insert).not.toHaveBeenCalled()
  })

  it("POST con EUR en una org USD es 400 con el mensaje del validador", async () => {
    vi.mocked(cargarConfigMoneda).mockResolvedValue(configUsd(true) as any)
    mockSupabaseFrom({ servicios: createChainMock(filaSrv()) })
    const { status, body } = await parseResponse(await POST(createPostRequest({ ...cuerpo, moneda: "EUR" })))
    expect(status).toBe(400)
    expect(body.error).toBe("La moneda del precio debe ser la moneda local o USD")
  })

  it("POST con moneda null explícita inserta null sin leer la configuración", async () => {
    const chain = createChainMock(filaSrv())
    mockSupabaseFrom({ servicios: chain })
    await POST(createPostRequest({ ...cuerpo, moneda: null }))
    expect(chain.insert.mock.calls[0][0].moneda).toBeNull()
    expect(cargarConfigMoneda).not.toHaveBeenCalled()
  })
})
