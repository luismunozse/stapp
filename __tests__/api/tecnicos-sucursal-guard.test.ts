/**
 * Tests: sucursal_id guard on POST /api/tecnicos
 *
 * Scenarios:
 *  TG.1 — org has no principal sucursal: returns 400, no insert
 *  TG.2 — org has principal sucursal: returns 201, insert includes sucursal_id
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import {
  mockSupabaseFrom,
  createChainMock,
  createPostRequest,
} from "./helpers"

// Must hoist before route import
vi.mock("@/lib/plan-limits", () => ({
  enforcePlanLimit: vi.fn().mockResolvedValue(null),
  isPlanLimitError: vi.fn().mockReturnValue(false),
  planLimitErrorResponse: vi.fn(),
}))

import { POST } from "@/app/api/tecnicos/route"

// ─── Auth helper ──────────────────────────────────────────────────────────────

function mockAdminAuth(sucursalId: string | null = null) {
  vi.mocked(auth).mockResolvedValue({
    user: {
      id: "admin-1",
      organizationId: "org-1",
      role: "ADMIN",
      sucursalId,
      email: "admin@test.com",
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

// ─── Valid minimal POST body ──────────────────────────────────────────────────

const validBody = {
  nombre: "Juan Tecnico",
  email: "juan@test.com",
  password: "secret123",
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/tecnicos — sucursal_id guard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("TG.1 — returns 400 and skips insert when org has no principal sucursal", async () => {
    mockAdminAuth(null) // ADMIN with no assigned branch, no cookie

    const usersChain = createChainMock(null) // for email duplicate check
    mockSupabaseFrom({
      // getPrincipalId uses .single() — null data means no principal
      sucursales: createChainMock(null),
      users: usersChain,
    })

    const res = await POST(createPostRequest(validBody))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toMatchObject({ error: expect.stringContaining("sucursal") })

    // No insert must have been called
    expect(usersChain.insert).not.toHaveBeenCalled()
  })

  it("TG.2 — returns 201 and insert includes sucursal_id when principal exists", async () => {
    mockAdminAuth(null) // ADMIN, no assigned branch — principal will be used

    const usersChain = createChainMock({
      id: "new-tec-1",
      nombre: "Juan Tecnico",
      email: "juan@test.com",
      porcentaje_comision: 0,
      costo_hora: 0,
      telefono: null,
      especialidades: [],
      fecha_ingreso_tecnico: null,
      activo: true,
    })

    // email duplicate check returns null (no existing user) for the first call,
    // then insert+select returns the new tecnico for the second call.
    let usersCallCount = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "sucursales") {
        return createChainMock({ id: "suc-principal" }) as any
      }
      if (table === "users") {
        usersCallCount++
        if (usersCallCount === 1) {
          // first call: email duplicate check → no duplicate
          return createChainMock(null) as any
        }
        // second call: insert + select → new tecnico
        return usersChain as any
      }
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await POST(createPostRequest(validBody))

    expect(res.status).toBe(201)

    // insert must have been called with sucursal_id = "suc-principal"
    expect(usersChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ sucursal_id: "suc-principal" })
    )
  })
})
