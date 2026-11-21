import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  parseResponse,
} from "./helpers"

import { POST } from "@/app/api/ordenes/foto-borrador/route"

describe("POST /api/ordenes/foto-borrador — emisión del token", () => {
  beforeEach(() => vi.clearAllMocks())

  it("rechaza sin sesión", async () => {
    mockAuthError()
    const res = await POST()
    expect(res.status).toBe(401)
  })

  it("rechaza a un rol que no puede crear órdenes", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    const res = await POST()
    expect(res.status).toBe(403)
  })

  it("devuelve el token crudo pero persiste solo el hash", async () => {
    mockAuthSuccess()
    const chain = createChainMock({ id: "draft-1" }, null, 0)
    mockSupabaseFrom({ foto_borrador: chain })

    const { status, body } = await parseResponse(await POST())

    expect(status).toBe(201)
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/)

    const persisted = JSON.stringify(chain.insert.mock.calls)
    expect(persisted).toContain("token_hash")
    expect(persisted).not.toContain(body.token)
  })

  it("corta cuando el usuario ya tiene el máximo de códigos activos", async () => {
    mockAuthSuccess()
    const chain = createChainMock({ id: "draft-1" }, null, 3)
    mockSupabaseFrom({ foto_borrador: chain })

    const res = await POST()
    expect(res.status).toBe(429)
    expect(chain.insert).not.toHaveBeenCalled()
  })
})
