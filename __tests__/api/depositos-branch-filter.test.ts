/**
 * Tests: PR1 — Branch filter on GET /api/depositos
 *
 * Scenarios per spec:
 *  (a) branch cookie set → only that branch's depositos returned (eq called)
 *  (b) verTodas (ADMIN, cookie = "todas") → all org depositos (no sucursal_id eq)
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse, createGetRequest } from "./helpers"
import { cookies } from "next/headers"

function mockCookie(value: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) =>
      name === "stapp-sucursal-activa" && value ? { value } : undefined
    ),
    set: vi.fn(),
  } as any)
}

import { GET } from "@/app/api/depositos/route"

describe("GET /api/depositos — branch filter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("branch-A cookie → depositos query filtered by sucursal_id", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const depositosChain = createChainMock([])
    depositosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ depositos: depositosChain })

    const res = await GET(createGetRequest("http://localhost:3000/api/depositos"))

    expect(res.status).toBe(200)
    expect(depositosChain.eq).toHaveBeenCalledWith("sucursal_id", "suc-A")
  })

  it("verTodas (cookie=todas) → no sucursal_id filter on depositos", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")

    const depositosChain = createChainMock([])
    depositosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ depositos: depositosChain })

    const res = await GET(createGetRequest("http://localhost:3000/api/depositos"))

    expect(res.status).toBe(200)
    const eqCalls = vi.mocked(depositosChain.eq).mock.calls
    expect(eqCalls.find((c: any[]) => c[0] === "sucursal_id")).toBeUndefined()
  })

  it("no cookie (ADMIN default) → no sucursal_id filter on depositos", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie(null)

    const depositosChain = createChainMock([])
    depositosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ depositos: depositosChain })

    const res = await GET(createGetRequest("http://localhost:3000/api/depositos"))

    expect(res.status).toBe(200)
    const eqCalls = vi.mocked(depositosChain.eq).mock.calls
    expect(eqCalls.find((c: any[]) => c[0] === "sucursal_id")).toBeUndefined()
  })
})
