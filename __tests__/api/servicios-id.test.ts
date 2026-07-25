import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

import { PUT, DELETE } from "@/app/api/servicios/[id]/route"

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe("PUT /api/servicios/[id]", () => {
  beforeEach(() => vi.clearAllMocks())

  it("actualiza el precio", async () => {
    mockAuthSuccess({ organizationId: "org-1", role: "ADMIN" })
    mockSupabaseFrom({
      servicios: createChainMock({
        id: "srv-1", codigo: "SRV-001", nombre: "Instalacion de Windows",
        descripcion: null, categoria: null, precio: 30000,
        duracion_estimada_min: null, activo: true,
      }),
    })

    const req = new Request("http://localhost:3000/api/servicios/srv-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ precio: 30000 }),
    })

    const { status, body } = await parseResponse(await PUT(req, params("srv-1")))

    expect(status).toBe(200)
    expect(body.servicio.precio).toBe(30000)
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
  })
})
