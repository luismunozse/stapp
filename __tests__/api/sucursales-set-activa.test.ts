import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

import { POST } from "@/app/api/sucursales/set-activa/route"

const url = "http://localhost:3000/api/sucursales/set-activa"

describe("POST /api/sucursales/set-activa", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("403 si no es ADMIN", async () => {
    mockAuthSuccess({ role: "VENDEDOR", organizationId: "org-1", userId: "v-1" })
    const res = await POST(createPostRequest({ sucursalId: "suc-1" }, url))
    const { status } = await parseResponse(res)
    expect(status).toBe(403)
  })

  it("ADMIN fija una sucursal válida", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "u-1" })
    mockSupabaseFrom({ sucursales: createChainMock({ id: "suc-1" }, null) }) // assertSucursalEnOrg ok
    const res = await POST(createPostRequest({ sucursalId: "suc-1" }, url))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.sucursalId).toBe("suc-1")
  })

  it("ADMIN puede elegir 'todas' sin validar DB", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "u-1" })
    const res = await POST(createPostRequest({ sucursalId: "todas" }, url))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.sucursalId).toBe("todas")
  })

  it("400 si la sucursal no pertenece a la org", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "u-1" })
    mockSupabaseFrom({ sucursales: createChainMock(null, { code: "PGRST116" }) }) // no encontrada
    const res = await POST(createPostRequest({ sucursalId: "suc-x" }, url))
    const { status } = await parseResponse(res)
    expect(status).toBe(400)
  })
})
