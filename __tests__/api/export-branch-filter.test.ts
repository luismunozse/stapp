/**
 * Tests: PR1 — Branch filter on export endpoints (ordenes, ventas)
 *
 * Scenarios per spec:
 *  (a) branch cookie set → only that branch's rows in export (eq called)
 *  (b) verTodas (ADMIN, cookie = "todas") → all org rows (no sucursal_id eq)
 *  (c) clientes export → always org-wide (no sucursal_id filter regardless of cookie)
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"
import { cookies } from "next/headers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

function mockCookie(value: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) =>
      name === "stapp-sucursal-activa" && value ? { value } : undefined
    ),
    set: vi.fn(),
  } as any)
}

function exportRequest(entity: string, query = "") {
  const url = `http://localhost:3000/api/export/${entity}${query}`
  return {
    req: new NextRequest(url),
    ctx: { params: Promise.resolve({ entity }) },
  }
}

import { GET } from "@/app/api/export/[entity]/route"

// ─── ordenes export ───────────────────────────────────────────────────────────

describe("GET /api/export/ordenes — branch filter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("branch-A cookie → ordenes query filtered by sucursal_id", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const ordenesChain = createChainMock([])
    ordenesChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ ordenes_servicio: ordenesChain })

    const { req, ctx } = exportRequest("ordenes")
    const res = await GET(req, ctx)

    expect(res.status).toBe(200)
    expect(ordenesChain.eq).toHaveBeenCalledWith("sucursal_id", "suc-A")
  })

  it("verTodas (cookie=todas) → no sucursal_id filter on ordenes", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")

    const ordenesChain = createChainMock([])
    ordenesChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ ordenes_servicio: ordenesChain })

    const { req, ctx } = exportRequest("ordenes")
    const res = await GET(req, ctx)

    expect(res.status).toBe(200)
    const eqCalls = vi.mocked(ordenesChain.eq).mock.calls
    expect(eqCalls.find((c: any[]) => c[0] === "sucursal_id")).toBeUndefined()
  })

  it("no cookie (ADMIN default) → no sucursal_id filter on ordenes", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie(null)

    const ordenesChain = createChainMock([])
    ordenesChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ ordenes_servicio: ordenesChain })

    const { req, ctx } = exportRequest("ordenes")
    const res = await GET(req, ctx)

    expect(res.status).toBe(200)
    const eqCalls = vi.mocked(ordenesChain.eq).mock.calls
    expect(eqCalls.find((c: any[]) => c[0] === "sucursal_id")).toBeUndefined()
  })
})

// ─── ventas export ────────────────────────────────────────────────────────────

describe("GET /api/export/ventas — branch filter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("branch-B cookie → ventas query filtered by sucursal_id", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-B")

    const ventasChain = createChainMock([])
    ventasChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ ventas: ventasChain })

    const { req, ctx } = exportRequest("ventas")
    const res = await GET(req, ctx)

    expect(res.status).toBe(200)
    expect(ventasChain.eq).toHaveBeenCalledWith("sucursal_id", "suc-B")
  })

  it("verTodas → no sucursal_id filter on ventas", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")

    const ventasChain = createChainMock([])
    ventasChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ ventas: ventasChain })

    const { req, ctx } = exportRequest("ventas")
    const res = await GET(req, ctx)

    expect(res.status).toBe(200)
    const eqCalls = vi.mocked(ventasChain.eq).mock.calls
    expect(eqCalls.find((c: any[]) => c[0] === "sucursal_id")).toBeUndefined()
  })
})

// ─── clientes export — always org-wide ───────────────────────────────────────

describe("GET /api/export/clientes — always org-wide (no branch filter)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("branch-A cookie → clientes export has NO sucursal_id filter", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const clientesChain = createChainMock([])
    clientesChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ clientes: clientesChain })

    const { req, ctx } = exportRequest("clientes")
    const res = await GET(req, ctx)

    expect(res.status).toBe(200)
    const eqCalls = vi.mocked(clientesChain.eq).mock.calls
    expect(eqCalls.find((c: any[]) => c[0] === "sucursal_id")).toBeUndefined()
  })

  it("verTodas → clientes export also has NO sucursal_id filter", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")

    const clientesChain = createChainMock([])
    clientesChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ clientes: clientesChain })

    const { req, ctx } = exportRequest("clientes")
    const res = await GET(req, ctx)

    expect(res.status).toBe(200)
    const eqCalls = vi.mocked(clientesChain.eq).mock.calls
    expect(eqCalls.find((c: any[]) => c[0] === "sucursal_id")).toBeUndefined()
  })
})
