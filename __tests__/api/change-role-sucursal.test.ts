/**
 * Tests: POST /api/superadmin/users/[userId]/change-role — sucursal_id handling.
 *
 * Scenarios:
 *  CR-1 — ADMIN (sucursal_id null) → TECNICO: update must set sucursal_id to org's principal branch
 *  CR-2 — TECNICO (sucursal_id "suc-A") → ADMIN: update must set sucursal_id to null
 *  CR-3 — TECNICO (sucursal_id "suc-A") → VENDEDOR: update must NOT change sucursal_id (stays "suc-A")
 *  CR-4 — ADMIN → TECNICO when org has no principal sucursal: must return 400
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/superadmin-auth", () => ({
  requireSuperadmin: vi.fn().mockResolvedValue({ error: null, email: "admin@stapp.com.ar" }),
}))

// Import AFTER the mock is registered
import { POST } from "@/app/api/superadmin/users/[userId]/change-role/route"

function postJson(userId: string, body: unknown): Request {
  return new Request(`http://localhost/api/superadmin/users/${userId}/change-role`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

const ctx = (userId: string) => ({ params: Promise.resolve({ userId }) })

/**
 * Build a per-call users chain:
 * - select → single: resolves with the given user
 * - update → returns a plain thenable chain
 */
function buildUsersChain(userData: object) {
  const updateChain = createChainMock(null, null)
  const chain: any = {}

  chain.select = vi.fn().mockReturnValue(chain)
  chain.eq = vi.fn().mockReturnValue(chain)
  chain.single = vi.fn().mockResolvedValue({ data: userData, error: null })

  // update() returns a separate chain that records what was passed
  chain.update = vi.fn().mockReturnValue(updateChain)

  // Make thenable (for paths that await without .single())
  chain.then = (resolve: any, reject?: any) =>
    Promise.resolve({ data: userData, error: null }).then(resolve, reject)
  chain.catch = (reject: any) =>
    Promise.resolve({ data: userData, error: null }).catch(reject)

  return { chain, updateChain }
}

describe("POST /api/superadmin/users/[userId]/change-role — sucursal_id management", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("CR-1 — ADMIN→TECNICO: update sets sucursal_id to org principal branch id", async () => {
    const { chain: usersChain, updateChain } = buildUsersChain({
      id: "user-1",
      nombre: "Ana",
      email: "ana@test.com",
      rol: "ADMIN",
      organization_id: "org-1",
      sucursal_id: null,
    })

    const sucursalesChain = createChainMock({ id: "suc-principal" })

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "users") return usersChain as any
      if (table === "sucursales") return sucursalesChain as any
      return createChainMock(null) as any
    })

    const res = await POST(postJson("user-1", { rol: "TECNICO" }), ctx("user-1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(usersChain.update).toHaveBeenCalledTimes(1)
    const updatePayload = usersChain.update.mock.calls[0][0]
    expect(updatePayload).toMatchObject({ rol: "TECNICO", sucursal_id: "suc-principal" })
  })

  it("CR-2 — TECNICO→ADMIN: update sets sucursal_id to null", async () => {
    const { chain: usersChain } = buildUsersChain({
      id: "user-2",
      nombre: "Bob",
      email: "bob@test.com",
      rol: "TECNICO",
      organization_id: "org-1",
      sucursal_id: "suc-A",
    })

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "users") return usersChain as any
      // sucursales should NOT be called here — ADMIN path doesn't need principal
      return createChainMock(null) as any
    })

    const res = await POST(postJson("user-2", { rol: "ADMIN" }), ctx("user-2"))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(usersChain.update).toHaveBeenCalledTimes(1)
    const updatePayload = usersChain.update.mock.calls[0][0]
    expect(updatePayload).toMatchObject({ rol: "ADMIN", sucursal_id: null })
  })

  it("CR-3 — TECNICO→VENDEDOR: update does NOT overwrite existing sucursal_id", async () => {
    const { chain: usersChain } = buildUsersChain({
      id: "user-3",
      nombre: "Carlos",
      email: "carlos@test.com",
      rol: "TECNICO",
      organization_id: "org-1",
      sucursal_id: "suc-A",
    })

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "users") return usersChain as any
      return createChainMock(null) as any
    })

    const res = await POST(postJson("user-3", { rol: "VENDEDOR" }), ctx("user-3"))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(usersChain.update).toHaveBeenCalledTimes(1)
    const updatePayload = usersChain.update.mock.calls[0][0]
    // update must include the new role
    expect(updatePayload.rol).toBe("VENDEDOR")
    // sucursal_id key must NOT be present in the update payload — leave DB value intact
    // (if present as null it would clear the existing branch, breaking the invariant)
    expect("sucursal_id" in updatePayload).toBe(false)
  })

  it("CR-4 — ADMIN→TECNICO when org has no principal sucursal: returns 400", async () => {
    const { chain: usersChain } = buildUsersChain({
      id: "user-4",
      nombre: "Dana",
      email: "dana@test.com",
      rol: "ADMIN",
      organization_id: "org-no-principal",
      sucursal_id: null,
    })

    // sucursales lookup returns null (no principal branch)
    const sucursalesChain = createChainMock(null)

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "users") return usersChain as any
      if (table === "sucursales") return sucursalesChain as any
      return createChainMock(null) as any
    })

    const res = await POST(postJson("user-4", { rol: "TECNICO" }), ctx("user-4"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toBeTruthy()
    // update must NOT have been called when org has no principal branch
    expect(usersChain.update).not.toHaveBeenCalled()
  })
})
