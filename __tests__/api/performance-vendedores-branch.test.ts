/**
 * PR3b — TDD test: performance-vendedores/route.ts passes p_sucursal_id to get_vendedores_stats RPC.
 *
 * Spec requirement: The route MUST pass `sucursalId` when `!verTodas`.
 * When verTodas, pass null. When branch-active, pass filtro.sucursalId.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockSupabaseFrom,
  createChainMock,
  parseResponse,
  createGetRequest,
} from "./helpers"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"

function mockCookie(value: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) =>
      name === "stapp-sucursal-activa" && value ? { value } : undefined
    ),
    set: vi.fn(),
  } as any)
}

describe("GET /api/reportes/performance-vendedores — p_sucursal_id RPC wiring (PR3b)", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const mod = await import("@/app/api/reportes/performance-vendedores/route")
    GET = mod.GET
  })

  it("passes p_sucursal_id = null to RPC when verTodas (cookie = 'todas')", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")

    mockSupabaseFrom({
      users: createChainMock([
        { id: "v-1", nombre: "Vendedor A" },
      ]),
    })

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: [
        {
          vendedor_id: "v-1",
          ventas_completadas: 5,
          ventas_anuladas: 1,
          ventas_total: 6,
          monto_total: 1500,
          ticket_promedio: 300,
        },
      ],
      error: null,
    } as any)

    const response = await GET(createGetRequest("http://localhost/api/reportes/performance-vendedores"))
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "get_vendedores_stats",
      expect.objectContaining({ p_sucursal_id: null })
    )
  })

  it("passes p_sucursal_id = 'suc-A' to RPC when branch-A cookie is active", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    mockSupabaseFrom({
      users: createChainMock([
        { id: "v-1", nombre: "Vendedor A" },
      ]),
    })

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: [
        {
          vendedor_id: "v-1",
          ventas_completadas: 3,
          ventas_anuladas: 0,
          ventas_total: 3,
          monto_total: 900,
          ticket_promedio: 300,
        },
      ],
      error: null,
    } as any)

    const response = await GET(createGetRequest("http://localhost/api/reportes/performance-vendedores"))
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "get_vendedores_stats",
      expect.objectContaining({ p_sucursal_id: "suc-A" })
    )
  })

  it("passes p_sucursal_id = 'suc-B' to RPC when branch-B cookie is active", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-B")

    mockSupabaseFrom({
      users: createChainMock([
        { id: "v-1", nombre: "Vendedor A" },
      ]),
    })

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: [],
      error: null,
    } as any)

    const response = await GET(createGetRequest("http://localhost/api/reportes/performance-vendedores"))
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "get_vendedores_stats",
      expect.objectContaining({ p_sucursal_id: "suc-B" })
    )
  })

  it("does NOT pass sucursal_id filter when no cookie set (ADMIN default = verTodas)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie(null)

    mockSupabaseFrom({
      users: createChainMock([]),
    })

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: [],
      error: null,
    } as any)

    const response = await GET(createGetRequest("http://localhost/api/reportes/performance-vendedores"))
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "get_vendedores_stats",
      expect.objectContaining({ p_sucursal_id: null })
    )
  })
})
