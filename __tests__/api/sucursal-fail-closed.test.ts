/**
 * Tests: Fail-closed integration — VENDEDOR with sucursalId null must NOT leak data.
 *
 * Scenario:
 *  FC-1 — VENDEDOR with sucursalId: null calls GET /api/turnos.
 *          The query must call .eq("sucursal_id", SUCURSAL_NINGUNA) — not skip the filter.
 *          Before the fix, sucursalId:null makes the && guard falsy → no filter → all rows leak.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { cookies } from "next/headers"
import { mockSupabaseFrom, createChainMock, createGetRequest } from "./helpers"
import { SUCURSAL_NINGUNA } from "@/lib/sucursal"

import { GET } from "@/app/api/turnos/route"

function mockAuthVendedorNoSucursal() {
  vi.mocked(auth).mockResolvedValue({
    user: {
      id: "vendedor-orphan",
      organizationId: "org-1",
      role: "VENDEDOR",
      sucursalId: null, // the broken state: non-admin without assigned branch
      email: "vendedor@test.com",
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

function mockNoCookie() {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn(() => undefined),
    set: vi.fn(),
  } as any)
}

describe("GET /api/turnos — fail-closed when VENDEDOR has no sucursal_id", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("FC-1 — VENDEDOR with sucursalId null: query MUST filter by SUCURSAL_NINGUNA (not skip filter)", async () => {
    mockAuthVendedorNoSucursal()
    mockNoCookie()

    const turnosChain = createChainMock([])
    turnosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ turnos: turnosChain })

    const res = await GET(createGetRequest("http://localhost:3000/api/turnos"))

    expect(res.status).toBe(200)

    const eqCalls = vi.mocked(turnosChain.eq).mock.calls as any[][]
    // The sentinel filter MUST be present — without it, all branches are visible
    const sucursalFilter = eqCalls.find((c) => c[0] === "sucursal_id")
    expect(sucursalFilter).toBeDefined()
    expect(sucursalFilter![1]).toBe(SUCURSAL_NINGUNA)
  })
})
