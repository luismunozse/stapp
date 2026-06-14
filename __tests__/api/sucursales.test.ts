import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  createGetRequest,
  parseResponse,
} from "./helpers"

// Aislar el gate de plan: testeamos la lógica de la route, no checkPlanLimit.
vi.mock("@/lib/plan-limits", () => ({
  enforcePlanLimit: vi.fn(),
}))

import { enforcePlanLimit } from "@/lib/plan-limits"
import { GET, POST } from "@/app/api/sucursales/route"

describe("/api/sucursales", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("GET 401 sin auth", async () => {
    mockAuthError()
    const res = await GET(createGetRequest("http://localhost:3000/api/sucursales"))
    const { status } = await parseResponse(res)
    expect(status).toBe(401)
  })

  it("POST crea sucursal cuando el plan lo permite", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "u-1" })
    vi.mocked(enforcePlanLimit).mockResolvedValue(null) // permitido

    const insertSpy = vi
      .fn()
      .mockReturnValue(createChainMock({ id: "suc-1", nombre: "Sucursal Norte", principal: false, activo: true }, null))
    mockSupabaseFrom({
      sucursales: { ...createChainMock({ id: "suc-1" }, null), insert: insertSpy } as any,
    })

    const res = await POST(
      createPostRequest({ nombre: "Sucursal Norte" }, "http://localhost:3000/api/sucursales")
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ organization_id: "org-1", nombre: "Sucursal Norte", activo: true })
    )
  })

  it("POST 403 cuando el plan llegó al límite", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "u-1" })
    vi.mocked(enforcePlanLimit).mockResolvedValue(
      NextResponse.json(
        { error: "Límite alcanzado", code: "PLAN_LIMIT_EXCEEDED", limitType: "sucursales" },
        { status: 403 }
      )
    )

    const res = await POST(
      createPostRequest({ nombre: "Otra Sucursal" }, "http://localhost:3000/api/sucursales")
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(403)
    expect(body.code).toBe("PLAN_LIMIT_EXCEEDED")
  })
})
