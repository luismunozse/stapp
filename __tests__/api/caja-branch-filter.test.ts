/**
 * Tests: branch scoping for GET /api/caja and GET /api/caja/export
 *
 * Regression guard: before the fix, fetchMovimientosDia is called without a
 * 5th sucursalId argument, and sinCobrar/sesionActual queries have no
 * sucursal_id filter — leaking data across all branches.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { cookies } from "next/headers"
import { mockSupabaseFrom, createChainMock, createGetRequest } from "./helpers"
import * as cajaUtils from "@/lib/caja-utils"
import { SUCURSAL_NINGUNA } from "@/lib/sucursal"

import { GET } from "@/app/api/caja/route"
import { GET as exportGET } from "@/app/api/caja/export/route"

// ─── Partial mock: keep computeTotales real, spy on fetchMovimientosDia ───────

vi.mock("@/lib/caja-utils", async (orig) => ({
  ...(await orig<typeof cajaUtils>()),
  fetchMovimientosDia: vi.fn().mockResolvedValue([]),
}))

// ─── Cookie mock ──────────────────────────────────────────────────────────────

function mockCookie(value: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) =>
      name === "stapp-sucursal-activa" && value ? { value } : undefined
    ),
    set: vi.fn(),
  } as any)
}

// ─── Auth mock that carries sucursalId on session.user ────────────────────────

function mockAuthWithSucursal(opts: {
  role?: string
  userId?: string
  organizationId?: string
  sucursalId?: string | null
}) {
  vi.mocked(auth).mockResolvedValue({
    user: {
      id: opts.userId ?? "user-1",
      organizationId: opts.organizationId ?? "org-1",
      role: opts.role ?? "ADMIN",
      sucursalId: opts.sucursalId ?? null,
      email: "test@test.com",
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

// ─── Shared supabase tables setup ─────────────────────────────────────────────

function mockCajaTables(
  sinCobrarChain = createChainMock([], null, 0),
  sesionChain = createChainMock(null, null)
) {
  mockSupabaseFrom({
    ordenes_servicio: sinCobrarChain,
    sesiones_caja: sesionChain,
    users: createChainMock({ id: "user-1", nombre: "Test User" }, null),
    organizations: createChainMock({
      zona_horaria: "America/Argentina/Buenos_Aires",
      vendedores_manejan_caja: true,
    }, null),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/caja — fetchMovimientosDia 5th arg
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/caja — fetchMovimientosDia sucursalId arg", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("VENDEDOR habilitado with sucursalId suc-A → 5th arg is 'suc-A'", async () => {
    mockAuthWithSucursal({ role: "VENDEDOR", sucursalId: "suc-A" })
    mockCookie(null)
    mockCajaTables()

    const res = await GET(createGetRequest("http://localhost:3000/api/caja"))

    expect(res.status).toBe(200)
    const call = vi.mocked(cajaUtils.fetchMovimientosDia).mock.calls[0]
    expect(call[4]).toBe("suc-A")
  })

  it("ADMIN with cookie 'todas' → 5th arg is null (no filter)", async () => {
    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie("todas")
    mockCajaTables()

    const res = await GET(createGetRequest("http://localhost:3000/api/caja"))

    expect(res.status).toBe(200)
    const call = vi.mocked(cajaUtils.fetchMovimientosDia).mock.calls[0]
    expect(call[4]).toBeNull()
  })

  it("ADMIN with no cookie → 5th arg is null (no filter)", async () => {
    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie(null)
    mockCajaTables()

    const res = await GET(createGetRequest("http://localhost:3000/api/caja"))

    expect(res.status).toBe(200)
    const call = vi.mocked(cajaUtils.fetchMovimientosDia).mock.calls[0]
    expect(call[4]).toBeNull()
  })

  it("ADMIN with cookie 'suc-B' → 5th arg is 'suc-B'", async () => {
    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie("suc-B")
    mockCajaTables()

    const res = await GET(createGetRequest("http://localhost:3000/api/caja"))

    expect(res.status).toBe(200)
    const call = vi.mocked(cajaUtils.fetchMovimientosDia).mock.calls[0]
    expect(call[4]).toBe("suc-B")
  })

  it("VENDEDOR with sucursalId null (mis-configured) → 5th arg is SUCURSAL_NINGUNA (fail-closed)", async () => {
    mockAuthWithSucursal({ role: "VENDEDOR", sucursalId: null })
    mockCookie(null)
    mockCajaTables()

    const res = await GET(createGetRequest("http://localhost:3000/api/caja"))

    expect(res.status).toBe(200)
    const call = vi.mocked(cajaUtils.fetchMovimientosDia).mock.calls[0]
    expect(call[4]).toBe(SUCURSAL_NINGUNA)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/caja — sinCobrar (ordenes_servicio) sucursal_id filter
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/caja — sinCobrar (ordenes_servicio) sucursal_id filter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("VENDEDOR habilitado suc-A → ordenes_servicio query gets .eq('sucursal_id', 'suc-A')", async () => {
    mockAuthWithSucursal({ role: "VENDEDOR", sucursalId: "suc-A" })
    mockCookie(null)

    const sinCobrarChain = createChainMock([], null, 0)
    mockSupabaseFrom({
      ordenes_servicio: sinCobrarChain,
      sesiones_caja: createChainMock(null, null),
      users: createChainMock({ id: "user-1", nombre: "Test" }, null),
    organizations: createChainMock({
      zona_horaria: "America/Argentina/Buenos_Aires",
      vendedores_manejan_caja: true,
    }, null),
    })

    await GET(createGetRequest("http://localhost:3000/api/caja"))

    const eqCalls = vi.mocked(sinCobrarChain.eq).mock.calls as any[][]
    expect(eqCalls.find((c) => c[0] === "sucursal_id" && c[1] === "suc-A")).toBeTruthy()
  })

  it("ADMIN verTodas → no sucursal_id eq on ordenes_servicio", async () => {
    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie("todas")

    const sinCobrarChain = createChainMock([], null, 0)
    mockSupabaseFrom({
      ordenes_servicio: sinCobrarChain,
      sesiones_caja: createChainMock(null, null),
      users: createChainMock({ id: "user-1", nombre: "Test" }, null),
    })

    await GET(createGetRequest("http://localhost:3000/api/caja"))

    const eqCalls = vi.mocked(sinCobrarChain.eq).mock.calls as any[][]
    expect(eqCalls.find((c) => c[0] === "sucursal_id")).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/caja — sesionActual (sesiones_caja) sucursal_id filter
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/caja — sesionActual (sesiones_caja) sucursal_id filter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("VENDEDOR habilitado suc-A → sesiones_caja query gets .eq('sucursal_id', 'suc-A')", async () => {
    mockAuthWithSucursal({ role: "VENDEDOR", sucursalId: "suc-A" })
    mockCookie(null)

    const sesionChain = createChainMock(null, null)
    mockSupabaseFrom({
      ordenes_servicio: createChainMock([], null, 0),
      sesiones_caja: sesionChain,
      users: createChainMock({ id: "user-1", nombre: "Test" }, null),
    organizations: createChainMock({
      zona_horaria: "America/Argentina/Buenos_Aires",
      vendedores_manejan_caja: true,
    }, null),
    })

    await GET(createGetRequest("http://localhost:3000/api/caja"))

    const eqCalls = vi.mocked(sesionChain.eq).mock.calls as any[][]
    expect(eqCalls.find((c) => c[0] === "sucursal_id" && c[1] === "suc-A")).toBeTruthy()
  })

  it("ADMIN verTodas → no sucursal_id eq on sesiones_caja", async () => {
    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie("todas")

    const sesionChain = createChainMock(null, null)
    mockSupabaseFrom({
      ordenes_servicio: createChainMock([], null, 0),
      sesiones_caja: sesionChain,
      users: createChainMock({ id: "user-1", nombre: "Test" }, null),
    })

    await GET(createGetRequest("http://localhost:3000/api/caja"))

    const eqCalls = vi.mocked(sesionChain.eq).mock.calls as any[][]
    expect(eqCalls.find((c) => c[0] === "sucursal_id")).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/caja/export — fetchMovimientosDia 5th arg (requireAdmin)
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/caja/export — fetchMovimientosDia sucursalId arg", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("ADMIN with cookie 'suc-B' → 5th arg is 'suc-B'", async () => {
    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie("suc-B")

    const res = await exportGET(createGetRequest("http://localhost:3000/api/caja/export"))

    // Response is CSV (200) or error — either way, check the call
    const call = vi.mocked(cajaUtils.fetchMovimientosDia).mock.calls[0]
    expect(call[4]).toBe("suc-B")
  })

  it("ADMIN verTodas (no cookie) → 5th arg is null", async () => {
    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie(null)

    await exportGET(createGetRequest("http://localhost:3000/api/caja/export"))

    const call = vi.mocked(cajaUtils.fetchMovimientosDia).mock.calls[0]
    expect(call[4]).toBeNull()
  })
})
