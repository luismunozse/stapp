// @vitest-environment node
/**
 * requireAuth() and the user's branch (sucursales-aislamiento, BM-2 / D1).
 *
 * `session.user.sucursalId` is signed into the JWT at login and only re-synced
 * in the last hours of the token's life, so a user moved to another branch kept
 * the old one for up to ~18 h. About 60 API files read that field and every one
 * of them gets it from requireAuth(), which makes it the single place to fix:
 * for a non-ADMIN it re-reads `users.sucursal_id` on each request.
 *
 * vitest.setup.ts replaces `@/lib/sesion-sucursal` with an identity ("the DB
 * agrees with the JWT") so the ~120 route suites that run as TECNICO/VENDEDOR
 * keep their supabase mock queues. This file un-mocks it to run the real thing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { createChainMock, createGetRequest, parseResponse } from "../api/helpers"

vi.unmock("@/lib/sesion-sucursal")

import { requireAuth, sesionConSucursalVigente } from "@/lib/auth-utils"
import { GET as getOperadores } from "@/app/api/operadores/route"

function sesion(role: string, sucursalId: string | null = "suc-A") {
  return {
    user: { id: "user-1", organizationId: "org-1", role, sucursalId, email: "u@test.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any
}

/** `users` answers the branch lookup with `row` (or the given error). */
function usersResponde(row: unknown, error: unknown = null) {
  const chain = createChainMock(row, error)
  vi.mocked(supabaseAdmin.from).mockImplementation(() => chain as any)
  return chain
}

describe("requireAuth — fresh branch for non-admins", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(["TECNICO", "VENDEDOR"])("%s: the DB branch wins over the stale JWT", async (role) => {
    vi.mocked(auth).mockResolvedValue(sesion(role, "suc-A"))
    usersResponde({ sucursal_id: "suc-B" })

    const r = await requireAuth()

    expect(r.error).toBeNull()
    expect(r.session!.user.sucursalId).toBe("suc-B")
    expect(r.userId).toBe("user-1")
    expect(r.organizationId).toBe("org-1")
    expect(r.role).toBe(role)
  })

  it("reads exactly users.sucursal_id by primary key", async () => {
    vi.mocked(auth).mockResolvedValue(sesion("TECNICO"))
    const chain = usersResponde({ sucursal_id: "suc-B" })

    await requireAuth()

    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
    expect(supabaseAdmin.from).toHaveBeenCalledWith("users")
    expect(chain.select).toHaveBeenCalledWith("sucursal_id")
    expect(chain.eq).toHaveBeenCalledWith("id", "user-1")
  })

  it("returns a copy: the session object that auth() produced is not mutated", async () => {
    const original = sesion("TECNICO", "suc-A")
    vi.mocked(auth).mockResolvedValue(original)
    usersResponde({ sucursal_id: "suc-B" })

    const r = await requireAuth()

    expect(r.session).not.toBe(original)
    expect(original.user.sucursalId).toBe("suc-A")
  })

  it("a user with no branch in the DB gets null, whatever the JWT claims", async () => {
    vi.mocked(auth).mockResolvedValue(sesion("VENDEDOR", "suc-A"))
    usersResponde({ sucursal_id: null })

    const r = await requireAuth()

    expect(r.error).toBeNull()
    expect(r.session!.user.sucursalId).toBeNull()
  })

  it("ADMIN does no extra query and keeps the session untouched", async () => {
    const admin = sesion("ADMIN", null)
    vi.mocked(auth).mockResolvedValue(admin)

    const r = await requireAuth()

    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(r.session).toBe(admin)
    expect(r.error).toBeNull()
  })

  it("an unauthenticated request is a 401 and never reaches the lookup", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)

    const r = await requireAuth()

    expect(r.error!.status).toBe(401)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it("fails closed with a 500 when the lookup returns an error (never guesses the JWT branch)", async () => {
    vi.mocked(auth).mockResolvedValue(sesion("TECNICO", "suc-A"))
    usersResponde(null, { message: "connection reset" })

    const r = await requireAuth()

    expect(r.error!.status).toBe(500)
    expect(r.session).toBeNull()
    expect(r.organizationId).toBeNull()
  })

  it("fails closed with a 500 when the lookup throws", async () => {
    vi.mocked(auth).mockResolvedValue(sesion("VENDEDOR", "suc-A"))
    const chain = usersResponde(null)
    chain.maybeSingle = vi.fn().mockRejectedValue(new Error("network down"))

    const r = await requireAuth()

    expect(r.error!.status).toBe(500)
    expect(r.session).toBeNull()
  })

  it("a user whose row no longer exists is a 401", async () => {
    vi.mocked(auth).mockResolvedValue(sesion("TECNICO", "suc-A"))
    usersResponde(null)

    const r = await requireAuth()

    expect(r.error!.status).toBe(401)
    expect(r.session).toBeNull()
  })
})

describe("existing callers get the fresh branch without edits", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("GET /api/operadores scopes a moved TECNICO to the branch in the DB, not the one in the JWT", async () => {
    vi.mocked(auth).mockResolvedValue(sesion("TECNICO", "suc-A"))
    const lookup = createChainMock({ sucursal_id: "suc-B" })
    const lista = createChainMock([{ id: "t-2", nombre: "Ana", rol: "TECNICO" }])
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(lookup as any) // requireAuth: branch lookup
      .mockReturnValueOnce(lista as any) // the route's own list query

    const res = await getOperadores(createGetRequest("http://localhost:3000/api/operadores"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body).toEqual([{ id: "t-2", nombre: "Ana", rol: "TECNICO" }])
    expect(lista.or).toHaveBeenCalledWith("sucursal_id.eq.suc-B,rol.eq.ADMIN")
    expect(lista.or).not.toHaveBeenCalledWith(expect.stringContaining("suc-A"))
  })

  it("GET /api/operadores answers 500 and runs no list query when the lookup fails", async () => {
    vi.mocked(auth).mockResolvedValue(sesion("TECNICO", "suc-A"))
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(createChainMock(null, { message: "boom" }) as any)

    const res = await getOperadores(createGetRequest("http://localhost:3000/api/operadores"))

    expect(res.status).toBe(500)
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })
})

describe("sesionConSucursalVigente — server pages that call auth() directly", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns the session with the DB branch for a non-admin", async () => {
    vi.mocked(auth).mockResolvedValue(sesion("TECNICO", "suc-A"))
    usersResponde({ sucursal_id: "suc-B" })

    const s = await sesionConSucursalVigente()

    expect(s!.user.sucursalId).toBe("suc-B")
    expect(s!.user.id).toBe("user-1")
  })

  it("returns null without a session, and null for a deleted user", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)
    expect(await sesionConSucursalVigente()).toBeNull()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()

    vi.mocked(auth).mockResolvedValue(sesion("VENDEDOR", "suc-A"))
    usersResponde(null)
    expect(await sesionConSucursalVigente()).toBeNull()
  })

  it("ADMIN passes through with no query", async () => {
    const admin = sesion("ADMIN", null)
    vi.mocked(auth).mockResolvedValue(admin)

    expect(await sesionConSucursalVigente()).toBe(admin)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it("throws when the lookup fails: a page must not render on a guessed branch", async () => {
    vi.mocked(auth).mockResolvedValue(sesion("TECNICO", "suc-A"))
    usersResponde(null, { message: "connection reset" })

    await expect(sesionConSucursalVigente()).rejects.toThrow()
  })
})
