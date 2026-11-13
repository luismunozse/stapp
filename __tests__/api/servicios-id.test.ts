import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

import { supabaseAdmin } from "@/lib/supabase"
import { cargarConfigMoneda } from "@/lib/currency/tipo-cambio.server"
import { resolverConfigMoneda } from "@/lib/currency/config-moneda"
import { PUT, DELETE } from "@/app/api/servicios/[id]/route"

vi.mock("@/lib/currency/tipo-cambio.server", () => ({ cargarConfigMoneda: vi.fn() }))

const configUsd = (habilitada: boolean) => ({
  config: { ...resolverConfigMoneda({ multimoneda_habilitada: habilitada, moneda_extranjera: "USD" } as any, "AR"), habilitada },
  fila: null,
})
const filaSrv = (extra: Record<string, unknown> = {}) => ({
  id: "srv-1", codigo: "SRV-001", nombre: "Instalacion", descripcion: null, categoria: null,
  precio: 50, duracion_estimada_min: null, activo: true, moneda: null, ...extra,
})

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe("PUT /api/servicios/[id]", () => {
  beforeEach(() => vi.clearAllMocks())

  it("actualiza el precio", async () => {
    mockAuthSuccess({ organizationId: "org-1", role: "ADMIN" })
    const chain = createChainMock({
      id: "srv-1", codigo: "SRV-001", nombre: "Instalacion de Windows",
      descripcion: null, categoria: null, precio: 30000,
      duracion_estimada_min: null, activo: true,
    })
    mockSupabaseFrom({ servicios: chain })

    const req = new Request("http://localhost:3000/api/servicios/srv-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ precio: 30000 }),
    })

    const { status, body } = await parseResponse(await PUT(req, params("srv-1")))

    expect(status).toBe(200)
    expect(body.servicio.precio).toBe(30000)
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("devuelve 403 si el usuario no es ADMIN", async () => {
    mockAuthSuccess({ organizationId: "org-1", role: "VENDEDOR" })
    mockSupabaseFrom({ servicios: createChainMock(null) })

    const req = new Request("http://localhost:3000/api/servicios/srv-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ precio: 1 }),
    })

    const { status } = await parseResponse(await PUT(req, params("srv-1")))
    expect(status).toBe(403)
  })

  it("devuelve 404 si el servicio no existe", async () => {
    mockAuthSuccess({ organizationId: "org-1", role: "ADMIN" })
    mockSupabaseFrom({
      servicios: createChainMock(null, { code: "PGRST116", message: "no rows returned" }),
    })

    const req = new Request("http://localhost:3000/api/servicios/srv-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ precio: 1 }),
    })

    const { status } = await parseResponse(await PUT(req, params("srv-1")))
    expect(status).toBe(404)
  })
})

describe("DELETE /api/servicios/[id]", () => {
  beforeEach(() => vi.clearAllMocks())

  it("hace soft delete y no borra la fila", async () => {
    mockAuthSuccess({ organizationId: "org-1", role: "ADMIN" })
    const chain = createChainMock({ id: "srv-1" })
    mockSupabaseFrom({ servicios: chain })

    const req = new Request("http://localhost:3000/api/servicios/srv-1", { method: "DELETE" })
    const { status } = await parseResponse(await DELETE(req, params("srv-1")))

    expect(status).toBe(200)
    expect(chain.update).toHaveBeenCalled()
    expect(chain.delete).not.toHaveBeenCalled()
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })
})

describe("PUT /api/servicios/[id] con moneda", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.from).mockReset()
    mockAuthSuccess({ organizationId: "org-1", role: "ADMIN" })
  })
  const put = (body: unknown) =>
    PUT(
      new Request("http://localhost:3000/api/servicios/srv-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      params("srv-1")
    )
  function dosLecturas(primera: unknown, segunda: unknown) {
    const cadena = createChainMock(segunda)
    vi.mocked(supabaseAdmin.from)
      .mockImplementationOnce((() => createChainMock(primera)) as any)
      .mockImplementationOnce((() => cadena) as any)
    return cadena
  }

  it("sin moneda no incluye la clave en el update ni lee la configuración", async () => {
    const chain = createChainMock(filaSrv({ moneda: "USD", precio: 60 }))
    mockSupabaseFrom({ servicios: chain })
    const { status, body } = await parseResponse(await put({ precio: 60 }))
    expect(status).toBe(200)
    expect(chain.update.mock.calls[0][0]).not.toHaveProperty("moneda")
    expect(body.servicio.moneda).toBe("USD")
    expect(cargarConfigMoneda).not.toHaveBeenCalled()
  })

  it("USD sobre un servicio que ya es USD con la función apagada es 200", async () => {
    vi.mocked(cargarConfigMoneda).mockResolvedValue(configUsd(false) as any)
    const chain = dosLecturas(filaSrv({ moneda: "USD" }), filaSrv({ moneda: "USD" }))
    const { status } = await parseResponse(await put({ moneda: "USD" }))
    expect(status).toBe(200)
    expect(chain.update.mock.calls[0][0].moneda).toBe("USD")
  })

  it("pasar un servicio local a USD con la función apagada es 400 y no actualiza", async () => {
    vi.mocked(cargarConfigMoneda).mockResolvedValue(configUsd(false) as any)
    const chain = dosLecturas(filaSrv(), filaSrv())
    const { status, body } = await parseResponse(await put({ moneda: "USD" }))
    expect(status).toBe(400)
    expect(body.error).toBe("La moneda extranjera está deshabilitada")
    expect(chain.update).not.toHaveBeenCalled()
  })

  it("moneda null vuelve el servicio a local sin leer nada más", async () => {
    const chain = createChainMock(filaSrv())
    mockSupabaseFrom({ servicios: chain })
    const { status } = await parseResponse(await put({ moneda: null }))
    expect(status).toBe(200)
    expect(chain.update.mock.calls[0][0]).toHaveProperty("moneda", null)
    expect(cargarConfigMoneda).not.toHaveBeenCalled()
  })

  it("EUR en una org USD es 400", async () => {
    vi.mocked(cargarConfigMoneda).mockResolvedValue(configUsd(true) as any)
    dosLecturas(filaSrv(), filaSrv())
    const { status } = await parseResponse(await put({ moneda: "EUR" }))
    expect(status).toBe(400)
  })

  it("una moneda sobre un servicio inexistente es 404", async () => {
    vi.mocked(supabaseAdmin.from).mockImplementationOnce((() => createChainMock(null)) as any)
    const { status } = await parseResponse(await put({ moneda: "USD" }))
    expect(status).toBe(404)
  })
})
