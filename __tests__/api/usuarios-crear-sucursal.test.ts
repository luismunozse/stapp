/**
 * Pins (BM-1): creating a technician or seller always lands them in exactly one
 * branch of the ACTOR's organization, with the role of the endpoint.
 *
 * "No principal -> 400" and "insert carries sucursal_id" already live in
 * tecnicos-sucursal-guard / vendedores-sucursal-guard. This file pins the other
 * half: what happens to a branch id sent in the body, and what cannot be smuggled
 * into the inserted row.
 *
 * A branch id the caller names explicitly is a request, not a hint: if it is not
 * an active branch of the actor's org the answer is 400 and nothing is written.
 * The principal is the fallback only when the body does not name a branch at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { createChainMock, createPostRequest } from "./helpers"

vi.mock("@/lib/plan-limits", () => ({
  enforcePlanLimit: vi.fn().mockResolvedValue(null),
  isPlanLimitError: vi.fn().mockReturnValue(false),
  planLimitErrorResponse: vi.fn(),
}))

import { POST as postTecnico } from "@/app/api/tecnicos/route"
import { POST as postVendedor } from "@/app/api/vendedores/route"

const CASOS = [
  { nombre: "POST /api/tecnicos", post: postTecnico, rol: "TECNICO" },
  { nombre: "POST /api/vendedores", post: postVendedor, rol: "VENDEDOR" },
] as const

const body = (extra: Record<string, unknown> = {}) => ({
  nombre: "Alta Nueva",
  email: "alta@test.com",
  password: "secret123",
  ...extra,
})

/**
 * Both routes read `sucursales` twice, in this order: the principal fallback, then
 * (only if the body names a branch) the org-scoped existence check. `users` is read
 * once for the duplicate-email check and then written once.
 */
function wireDb(opts: { principal: string | null; bodyBranchExists?: string | null }) {
  const principalChain = createChainMock(opts.principal ? { id: opts.principal } : null)
  const existeChain = createChainMock(opts.bodyBranchExists ? { id: opts.bodyBranchExists } : null)
  const insertChain = createChainMock({ id: "nuevo-1", nombre: "Alta Nueva", email: "alta@test.com", activo: true })
  const sucursalesQueue = [principalChain, existeChain]
  let usersCalls = 0

  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "sucursales") return (sucursalesQueue.shift() ?? createChainMock(null)) as any
    if (table === "users") return (usersCalls++ === 0 ? createChainMock(null) : insertChain) as any
    return createChainMock(null, { message: `No mock for table: ${table}` }) as any
  })
  return { existeChain, insertChain }
}

describe.each(CASOS)("$nombre — branch membership on create", ({ post, rol }) => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(auth).mockResolvedValue({
      user: { id: "admin-1", organizationId: "org-1", role: "ADMIN", sucursalId: null, email: "admin@test.com" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as any)
  })

  it("an explicit branch that is not an active branch of the org is a 400, even though a principal exists to fall back to", async () => {
    const { existeChain, insertChain } = wireDb({ principal: "suc-principal", bodyBranchExists: null })

    const res = await post(createPostRequest(body({ sucursalId: "suc-inactiva-o-ajena" })))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("La sucursal elegida no existe o está inactiva.")
    expect(insertChain.insert).not.toHaveBeenCalled()
    // The lookup that said "no" is the org-scoped, active-only, not-deleted one.
    expect(existeChain.eq).toHaveBeenCalledWith("id", "suc-inactiva-o-ajena")
    expect(existeChain.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(existeChain.eq).toHaveBeenCalledWith("activo", true)
    expect(existeChain.is).toHaveBeenCalledWith("deleted_at", null)
  })

  it("the same rejection holds for an org without a principal: nothing is written", async () => {
    const { insertChain } = wireDb({ principal: null, bodyBranchExists: null })

    const res = await post(createPostRequest(body({ sucursalId: "suc-ajena" })))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("La sucursal elegida no existe o está inactiva.")
    expect(insertChain.insert).not.toHaveBeenCalled()
  })

  it("stores the branch chosen in the form when it is an active branch of the org", async () => {
    const { existeChain, insertChain } = wireDb({ principal: "suc-principal", bodyBranchExists: "suc-cerro" })

    const res = await post(createPostRequest(body({ sucursalId: "suc-cerro" })))

    expect(res.status).toBe(201)
    expect(existeChain.eq).toHaveBeenCalledWith("activo", true)
    expect(insertChain.insert.mock.calls[0][0].sucursal_id).toBe("suc-cerro")
  })

  it.each([
    ["omitted", undefined],
    ["empty", ""],
    ["null", null],
  ])("falls back to the principal, without looking the body branch up, when sucursalId is %s", async (_caso, valor) => {
    const { existeChain, insertChain } = wireDb({ principal: "suc-principal", bodyBranchExists: "no-se-consulta" })

    const res = await post(createPostRequest(body({ sucursalId: valor })))

    expect(res.status).toBe(201)
    expect(existeChain.eq).not.toHaveBeenCalled()
    expect(insertChain.insert.mock.calls[0][0].sucursal_id).toBe("suc-principal")
  })

  it(`always inserts a ${rol} of the actor's org with a branch, whatever the body claims`, async () => {
    const { insertChain } = wireDb({ principal: "suc-principal" })

    const res = await post(
      createPostRequest(body({ rol: "ADMIN", sucursal_id: null, organization_id: "otra-org", organizationId: "otra-org" }))
    )

    expect(res.status).toBe(201)
    const fila = insertChain.insert.mock.calls[0][0]
    expect(fila).toMatchObject({ rol, organization_id: "org-1", sucursal_id: "suc-principal" })
  })
})
