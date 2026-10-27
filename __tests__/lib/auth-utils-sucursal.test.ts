// @vitest-environment node
/**
 * requireAuth() and the user's branch (sucursales-aislamiento, BM-2 / D1).
 *
 * `session.user.sucursalId` is signed into the JWT at login and only re-synced
 * in the last hours of the token's life, so a user moved to another branch kept
 * the old one for up to ~18 h. About 60 API files read that field and every one
 * of them gets it from requireAuth(), which makes it the single place to fix:
 * it re-reads the user's row (branch, role, org, deletion mark) with a 5 s
 * per-instance cache and single-flight. A non-ADMIN gets the DB branch; every
 * role, ADMIN included, gets a 401 SESSION_STALE (and a cleared session cookie)
 * when the JWT no longer matches the row.
 *
 * vitest.setup.ts replaces `@/lib/sesion-sucursal` with an identity ("the DB
 * agrees with the JWT") so the ~120 route suites that run as TECNICO/VENDEDOR
 * keep their supabase mock queues. This file un-mocks it to run the real thing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { validateUserTenant } from "@/lib/tenant"
import { createChainMock, createGetRequest, createPostRequest, parseResponse } from "../api/helpers"

vi.unmock("@/lib/sesion-sucursal")
vi.mock("@/lib/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tenant")>()),
  validateUserTenant: vi.fn(),
}))

import { requireAuth, requireAdmin, requireAdminOrVendedor, requirePosAccess, sesionConSucursalVigente } from "@/lib/auth-utils"
import { CACHE_MAX_ENTRIES, clearSesionSucursalCache, conSucursalVigente } from "@/lib/sesion-sucursal"
import { GET as getOperadores } from "@/app/api/operadores/route"
import { POST as postTurno } from "@/app/api/turnos/route"

function sesion(role: string, sucursalId: string | null = "suc-A") {
  return {
    user: { id: "user-1", organizationId: "org-1", role, sucursalId, email: "u@test.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any
}

/** The `users` row the lookup reads. Defaults agree with sesion("TECNICO"), moved to suc-B. */
function fila(over: Record<string, unknown> = {}) {
  return { rol: "TECNICO", sucursal_id: "suc-B", organization_id: "org-1", deleted_at: null, ...over }
}

/** `users` answers the lookup with `row` (or the given error). */
function usersResponde(row: unknown, error: unknown = null) {
  const chain = createChainMock(row, error)
  vi.mocked(supabaseAdmin.from).mockImplementation(() => chain as any)
  return chain
}

function conSlug(slug: string) {
  return { get: (k: string) => (k === "x-tenant-slug" ? slug : null) } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  clearSesionSucursalCache()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("requireAuth — fresh branch for non-admins", () => {
  it.each(["TECNICO", "VENDEDOR"])("%s: the DB branch wins over the stale JWT", async (role) => {
    vi.mocked(auth).mockResolvedValue(sesion(role, "suc-A"))
    usersResponde(fila({ rol: role }))

    const r = await requireAuth()

    expect(r.error).toBeNull()
    expect(r.session!.user.sucursalId).toBe("suc-B")
    expect(r.userId).toBe("user-1")
    expect(r.organizationId).toBe("org-1")
    expect(r.role).toBe(role)
  })

  it("reads branch, role, org and deletion mark by primary key in ONE query", async () => {
    vi.mocked(auth).mockResolvedValue(sesion("TECNICO"))
    const chain = usersResponde(fila())

    await requireAuth()

    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
    expect(supabaseAdmin.from).toHaveBeenCalledWith("users")
    expect(chain.select).toHaveBeenCalledTimes(1)
    const columnas = String(vi.mocked(chain.select).mock.calls[0][0]).split(",").map((c) => c.trim())
    expect(columnas).toEqual(expect.arrayContaining(["sucursal_id", "rol", "organization_id", "deleted_at"]))
    expect(chain.eq).toHaveBeenCalledWith("id", "user-1")
  })

  it("returns a copy: the session object that auth() produced is not mutated", async () => {
    const original = sesion("TECNICO", "suc-A")
    vi.mocked(auth).mockResolvedValue(original)
    usersResponde(fila())

    const r = await requireAuth()

    expect(r.session).not.toBe(original)
    expect(original.user.sucursalId).toBe("suc-A")
  })

  it("a user with no branch in the DB gets null, whatever the JWT claims", async () => {
    vi.mocked(auth).mockResolvedValue(sesion("VENDEDOR", "suc-A"))
    usersResponde(fila({ rol: "VENDEDOR", sucursal_id: null }))

    const r = await requireAuth()

    expect(r.error).toBeNull()
    expect(r.session!.user.sucursalId).toBeNull()
  })

  it("ADMIN is verified too, but its session is returned untouched (no branch, 'Todas' keeps working)", async () => {
    const admin = sesion("ADMIN", null)
    vi.mocked(auth).mockResolvedValue(admin)
    const chain = usersResponde(fila({ rol: "ADMIN", sucursal_id: "suc-X" }))

    const r = await requireAuth()

    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
    expect(chain.eq).toHaveBeenCalledWith("id", "user-1")
    expect(r.error).toBeNull()
    expect(r.session).toBe(admin)
    expect(r.session!.user.sucursalId).toBeNull()
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
    expect(await r.error!.json()).toEqual({ error: "No pudimos verificar tu sesión. Intentá de nuevo." })
    expect(r.session).toBeNull()
    expect(r.organizationId).toBeNull()
  })

  it("fails closed for an ADMIN too when the lookup fails", async () => {
    vi.mocked(auth).mockResolvedValue(sesion("ADMIN", null))
    usersResponde(null, { message: "connection reset" })

    const r = await requireAuth()

    expect(r.error!.status).toBe(500)
    expect(r.session).toBeNull()
  })

  it("fails closed with a 500 when the lookup throws", async () => {
    vi.mocked(auth).mockResolvedValue(sesion("VENDEDOR", "suc-A"))
    const chain = usersResponde(null)
    chain.maybeSingle = vi.fn().mockRejectedValue(new Error("network down"))

    const r = await requireAuth()

    expect(r.error!.status).toBe(500)
    expect(r.session).toBeNull()
  })

})

describe("requireAuth — a JWT that no longer matches the user's row is a stale session", () => {
  const MENSAJE = "Tu sesión cambió. Volvé a iniciar sesión."

  it.each([
    ["the row does not exist", "TECNICO", null],
    ["the DB role changed (VENDEDOR in the JWT, TECNICO in the DB)", "VENDEDOR", fila({ rol: "TECNICO" })],
    ["the DB role was promoted to ADMIN", "TECNICO", fila({ rol: "ADMIN" })],
    ["the DB organization is another one", "TECNICO", fila({ organization_id: "org-2" })],
    ["the DB row has a null organization", "TECNICO", fila({ organization_id: null })],
    ["the user was deleted", "TECNICO", fila({ deleted_at: "2026-10-27T12:00:00Z" })],
    ["an ADMIN was demoted in the DB", "ADMIN", fila({ rol: "TECNICO", sucursal_id: "suc-A" })],
    ["an ADMIN's organization is another one", "ADMIN", fila({ rol: "ADMIN", organization_id: "org-2", sucursal_id: null })],
    ["an ADMIN was deleted", "ADMIN", fila({ rol: "ADMIN", deleted_at: "2026-10-27T12:00:00Z", sucursal_id: null })],
  ])("%s: 401 SESSION_STALE and the session cookie is cleared", async (_caso, rolJwt, row) => {
    vi.mocked(auth).mockResolvedValue(sesion(rolJwt, rolJwt === "ADMIN" ? null : "suc-A"))
    usersResponde(row)

    const r = await requireAuth()

    expect(r.error!.status).toBe(401)
    expect(await r.error!.json()).toEqual({ error: MENSAJE, code: "SESSION_STALE" })
    const setCookie = r.error!.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain("next-auth.session-token=;")
    expect(setCookie).toContain("Max-Age=0")
    expect(r.session).toBeNull()
    expect(r.userId).toBeNull()
  })

  it.each([
    ["a TECNICO whose role changed", "TECNICO", fila({ rol: "VENDEDOR" })],
    ["an ADMIN that was deleted", "ADMIN", fila({ rol: "ADMIN", deleted_at: "2026-10-27T12:00:00Z", sucursal_id: null })],
  ])("an impersonation session (%s) still gets the 401 SESSION_STALE but keeps its cookie", async (_caso, rolJwt, row) => {
    // Clearing it would drop the impersonation token the superadmin needs to exit
    // (same skip as middleware.ts deletedUserResponse).
    const impersonada = sesion(rolJwt, rolJwt === "ADMIN" ? null : "suc-A")
    impersonada.user.isImpersonating = true
    vi.mocked(auth).mockResolvedValue(impersonada)
    usersResponde(row)

    const r = await requireAuth()

    expect(r.error!.status).toBe(401)
    expect(await r.error!.json()).toEqual({ error: MENSAJE, code: "SESSION_STALE" })
    expect(r.error!.headers.get("set-cookie")).toBeNull()
    expect(r.session).toBeNull()
  })

  it("a plain 401 (no session at all) does not touch the cookie", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)

    const r = await requireAuth()

    expect(r.error!.status).toBe(401)
    expect(r.error!.headers.get("set-cookie")).toBeNull()
  })

  it("an unchanged ADMIN passes", async () => {
    const admin = sesion("ADMIN", null)
    vi.mocked(auth).mockResolvedValue(admin)
    usersResponde(fila({ rol: "ADMIN", sucursal_id: null }))

    const r = await requireAuth()

    expect(r.error).toBeNull()
    expect(r.session).toBe(admin)
  })

  it("a deleted user is also null for server pages", async () => {
    vi.mocked(auth).mockResolvedValue(sesion("TECNICO", "suc-A"))
    usersResponde(fila({ deleted_at: "2026-10-27T12:00:00Z" }))
    expect(await sesionConSucursalVigente()).toBeNull()

    clearSesionSucursalCache()
    usersResponde(fila({ rol: "VENDEDOR" }))
    expect(await sesionConSucursalVigente()).toBeNull()
  })
})

describe("requireAuth — 5 s per-instance cache of the users row", () => {
  const T0 = new Date("2026-10-27T12:00:00Z").getTime()

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(T0)
  })

  it("a second request inside the TTL is served from memory", async () => {
    vi.mocked(auth).mockResolvedValue(sesion("TECNICO", "suc-A"))
    usersResponde(fila())

    const primera = await requireAuth()
    vi.setSystemTime(T0 + 4_000)
    const segunda = await requireAuth()

    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
    expect(primera.session!.user.sucursalId).toBe("suc-B")
    expect(segunda.session!.user.sucursalId).toBe("suc-B")
  })

  it("after the TTL the row is read again, so a move shows up", async () => {
    vi.mocked(auth).mockResolvedValue(sesion("TECNICO", "suc-A"))
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(createChainMock(fila({ sucursal_id: "suc-B" })) as any)
      .mockReturnValueOnce(createChainMock(fila({ sucursal_id: "suc-C" })) as any)

    const antes = await requireAuth()
    vi.setSystemTime(T0 + 5_001)
    const despues = await requireAuth()

    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2)
    expect(antes.session!.user.sucursalId).toBe("suc-B")
    expect(despues.session!.user.sucursalId).toBe("suc-C")
  })

  it("entries are per user", async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(createChainMock(fila({ sucursal_id: "suc-B" })) as any)
      .mockReturnValueOnce(createChainMock(fila({ sucursal_id: "suc-C" })) as any)

    vi.mocked(auth).mockResolvedValue(sesion("TECNICO"))
    const u1 = await requireAuth()
    vi.mocked(auth).mockResolvedValue({ ...sesion("TECNICO"), user: { ...sesion("TECNICO").user, id: "user-2" } })
    const u2 = await requireAuth()

    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2)
    expect(u1.session!.user.sucursalId).toBe("suc-B")
    expect(u2.session!.user.sucursalId).toBe("suc-C")
  })

  it("a cache hit still checks role and org against the CURRENT JWT", async () => {
    usersResponde(fila({ rol: "TECNICO" }))
    vi.mocked(auth).mockResolvedValue(sesion("TECNICO"))
    expect((await requireAuth()).error).toBeNull()

    vi.mocked(auth).mockResolvedValue(sesion("VENDEDOR"))
    const r = await requireAuth()

    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
    expect(r.error!.status).toBe(401)
  })

  it("a failed lookup and a missing row are never cached", async () => {
    vi.mocked(auth).mockResolvedValue(sesion("TECNICO", "suc-A"))
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(createChainMock(null, { message: "boom" }) as any)
      .mockReturnValueOnce(createChainMock(null) as any)
      .mockReturnValueOnce(createChainMock(fila()) as any)

    expect((await requireAuth()).error!.status).toBe(500)
    expect((await requireAuth()).error!.status).toBe(401)
    const ok = await requireAuth()

    expect(supabaseAdmin.from).toHaveBeenCalledTimes(3)
    expect(ok.error).toBeNull()
    expect(ok.session!.user.sucursalId).toBe("suc-B")
  })

  it("an unchanged ADMIN costs at most one lookup per TTL", async () => {
    vi.mocked(auth).mockResolvedValue(sesion("ADMIN", null))
    usersResponde(fila({ rol: "ADMIN", sucursal_id: null }))

    await requireAuth()
    vi.setSystemTime(T0 + 4_000)
    await requireAuth()
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)

    vi.setSystemTime(T0 + 5_001)
    await requireAuth()
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2)
  })

  it("a demoted ADMIN is caught on a cache hit too (the comparison uses the current JWT)", async () => {
    usersResponde(fila({ rol: "TECNICO", sucursal_id: "suc-A" }))
    vi.mocked(auth).mockResolvedValue(sesion("TECNICO"))
    expect((await requireAuth()).error).toBeNull()

    vi.mocked(auth).mockResolvedValue(sesion("ADMIN", null))
    const r = await requireAuth()

    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
    expect(r.error!.status).toBe(401)
  })
})

describe("requireAuth — single-flight lookup", () => {
  /** Every lookup waits at a gate; `abrir()` lets all of them through. */
  function conPuerta(resultado: () => Promise<{ data: unknown; error: unknown }>) {
    let abrir!: () => void
    const puerta = new Promise<void>((r) => (abrir = r))
    const chain = createChainMock(null)
    chain.maybeSingle = vi.fn(async () => {
      await puerta
      return resultado()
    })
    vi.mocked(supabaseAdmin.from).mockImplementation(() => chain as any)
    return { abrir }
  }
  // One macrotask: every pending requireAuth() has reached the lookup by then.
  const alcanzanElLookup = () => new Promise((r) => setTimeout(r, 0))

  it("N parallel requests of one user on a miss share ONE query", async () => {
    vi.mocked(auth).mockResolvedValue(sesion("TECNICO", "suc-A"))
    const { abrir } = conPuerta(async () => ({ data: fila(), error: null }))

    const llamadas = Array.from({ length: 5 }, () => requireAuth())
    await alcanzanElLookup()
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
    abrir()
    const rs = await Promise.all(llamadas)

    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
    expect(rs).toHaveLength(5)
    for (const r of rs) {
      expect(r.error).toBeNull()
      expect(r.session!.user.sucursalId).toBe("suc-B")
    }
  })

  it("parallel requests of different users do not share a query", async () => {
    const { abrir } = conPuerta(async () => ({ data: fila(), error: null }))
    const otro = { ...sesion("TECNICO"), user: { ...sesion("TECNICO").user, id: "user-2" } }

    vi.mocked(auth).mockResolvedValue(sesion("TECNICO"))
    const a = requireAuth()
    vi.mocked(auth).mockResolvedValue(otro)
    const b = requireAuth()
    await alcanzanElLookup()
    abrir()
    await Promise.all([a, b])

    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2)
  })

  it("a failing in-flight lookup fails every waiter and is not cached", async () => {
    vi.mocked(auth).mockResolvedValue(sesion("TECNICO", "suc-A"))
    const { abrir } = conPuerta(async () => {
      throw new Error("down")
    })

    const llamadas = Array.from({ length: 3 }, () => requireAuth())
    await alcanzanElLookup()
    abrir()
    const rs = await Promise.all(llamadas)

    expect(rs.map((r) => r.error!.status)).toEqual([500, 500, 500])
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)

    usersResponde(fila())
    const despues = await requireAuth()

    expect(despues.error).toBeNull()
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2)
  })

  it("two in-flight callers with different JWT roles share ONE query and are judged separately", async () => {
    const { abrir } = conPuerta(async () => ({ data: fila({ rol: "TECNICO" }), error: null }))
    const deRol = (role: string) => ({
      user: { id: "user-1", role, organizationId: "org-1", sucursalId: "suc-A" as string | null },
    })

    const coincide = conSucursalVigente(deRol("TECNICO"))
    const cambioDeRol = conSucursalVigente(deRol("VENDEDOR"))
    await alcanzanElLookup()
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
    abrir()
    const [a, b] = await Promise.all([coincide, cambioDeRol])

    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
    expect(a!.user.sucursalId).toBe("suc-B")
    expect(b).toBeNull()
  })

  it("a flight that settles late does not remove the entry of a newer flight", async () => {
    // Two flights of one user only coexist if the cache is cleared in between.
    const compuertas: Array<(r: { data: unknown; error: unknown }) => void> = []
    vi.mocked(supabaseAdmin.from).mockImplementation((() => {
      const chain = createChainMock(null)
      chain.maybeSingle = vi.fn(() => new Promise((resolver) => compuertas.push(resolver)))
      return chain
    }) as any)
    const sesionDe = () => ({
      user: { id: "user-1", role: "TECNICO", organizationId: "org-1", sucursalId: null as string | null },
    })

    const vieja = conSucursalVigente(sesionDe())
    clearSesionSucursalCache()
    const nueva = conSucursalVigente(sesionDe())
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2)

    const viejaFallo = expect(vieja).rejects.toThrow()
    compuertas[0]({ data: null, error: { message: "boom" } }) // the old flight settles first, failing
    await viejaFallo

    const otra = conSucursalVigente(sesionDe()) // must join the newer flight, not start a third query
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2)

    compuertas[1]({ data: fila(), error: null })
    const [n, o] = await Promise.all([nueva, otra])
    expect(n!.user.sucursalId).toBe("suc-B")
    expect(o!.user.sucursalId).toBe("suc-B")
  })
})

describe("requireAuth — the lookup is bounded", () => {
  const T0 = new Date("2026-10-27T12:00:00Z").getTime()
  const vaciarMicrotareas = async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve()
  }

  it("a query that never settles is aborted after 3 s: 500, and the next request issues a new query", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] })
    vi.setSystemTime(T0)
    // AbortSignal.timeout runs on native timers that fake timers do not move, so
    // it is rebuilt on top of the faked setTimeout.
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      const controlador = new AbortController()
      setTimeout(() => controlador.abort(new DOMException("The operation timed out.", "TimeoutError")), ms)
      return controlador.signal
    })
    try {
      vi.mocked(auth).mockResolvedValue(sesion("TECNICO", "suc-A"))
      // Like fetch, the colgada query only ends when the signal it was given aborts.
      const colgada = createChainMock(null)
      let senal!: AbortSignal
      colgada.abortSignal = vi.fn((s: AbortSignal) => {
        senal = s
        return colgada
      })
      colgada.maybeSingle = vi.fn(
        () => new Promise((_, rechazar) => senal.addEventListener("abort", () => rechazar(senal.reason)))
      )
      vi.mocked(supabaseAdmin.from).mockReturnValueOnce(colgada as any)

      let resuelta = false
      const pendiente = requireAuth().then((r) => {
        resuelta = true
        return r
      })
      await vaciarMicrotareas()
      expect(timeout).toHaveBeenCalledWith(3_000)
      expect(colgada.abortSignal).toHaveBeenCalledWith(senal)

      await vi.advanceTimersByTimeAsync(2_999)
      expect(resuelta).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      const r = await pendiente

      expect(r.error!.status).toBe(500)
      expect(r.session).toBeNull()

      // The aborted flight left nothing behind: the next request queries again.
      vi.mocked(supabaseAdmin.from).mockReturnValueOnce(createChainMock(fila()) as any)
      const despues = requireAuth()
      await vaciarMicrotareas()
      const ok = await despues
      expect(supabaseAdmin.from).toHaveBeenCalledTimes(2)
      expect(ok.error).toBeNull()
      expect(ok.session!.user.sucursalId).toBe("suc-B")
    } finally {
      timeout.mockRestore()
    }
  })

  it("a lookup that answers in time is untouched by the bound", async () => {
    vi.mocked(auth).mockResolvedValue(sesion("TECNICO", "suc-A"))
    const chain = usersResponde(fila())
    const timeout = vi.spyOn(AbortSignal, "timeout")
    try {
      const r = await requireAuth()

      expect(r.error).toBeNull()
      expect(chain.abortSignal).toHaveBeenCalledTimes(1)
      expect(timeout).toHaveBeenCalledWith(3_000)
    } finally {
      timeout.mockRestore()
    }
  })
})

describe("cache bound", () => {
  const T0 = new Date("2026-10-27T12:00:00Z").getTime()
  const usuario = (i: number) => ({
    user: { id: `u${i}`, role: "TECNICO", organizationId: "org-1", sucursalId: null as string | null },
  })

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(T0)
    usersResponde(fila())
  })

  it("a full cache is cleared when a NEW user arrives", async () => {
    for (let i = 0; i < CACHE_MAX_ENTRIES; i++) await conSucursalVigente(usuario(i))
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(CACHE_MAX_ENTRIES)

    await conSucursalVigente(usuario(CACHE_MAX_ENTRIES)) // new key on a full cache
    await conSucursalVigente(usuario(CACHE_MAX_ENTRIES)) // cached again
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(CACHE_MAX_ENTRIES + 1)

    await conSucursalVigente(usuario(0)) // evicted by the clear
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(CACHE_MAX_ENTRIES + 2)
  })

  it("refreshing a user that is already in a full cache clears nobody else", async () => {
    await conSucursalVigente(usuario(0))
    vi.setSystemTime(T0 + 3_000)
    for (let i = 1; i < CACHE_MAX_ENTRIES; i++) await conSucursalVigente(usuario(i)) // exactly full now
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(CACHE_MAX_ENTRIES)

    vi.setSystemTime(T0 + 5_500) // u0 has expired, everyone else is valid until T0 + 8_000
    await conSucursalVigente(usuario(0))
    await conSucursalVigente(usuario(1))

    expect(supabaseAdmin.from).toHaveBeenCalledTimes(CACHE_MAX_ENTRIES + 1) // only u0 was re-read
  })
})

describe("requireAuth — tenant check and branch lookup", () => {
  it("run concurrently: the lookup starts while the tenant check is still pending", async () => {
    vi.mocked(auth).mockResolvedValue(sesion("TECNICO", "suc-A"))
    usersResponde(fila())
    vi.mocked(headers).mockReturnValueOnce(conSlug("acme"))
    let resolverTenant!: (v: boolean) => void
    vi.mocked(validateUserTenant).mockReturnValueOnce(new Promise<boolean>((r) => (resolverTenant = r)))

    const pendiente = requireAuth()
    await vi.waitFor(() => expect(supabaseAdmin.from).toHaveBeenCalledWith("users"))
    resolverTenant(true)
    const r = await pendiente

    expect(validateUserTenant).toHaveBeenCalledWith("org-1", "acme")
    expect(r.error).toBeNull()
    expect(r.session!.user.sucursalId).toBe("suc-B")
  })

  it.each([
    ["a lookup that succeeds", () => usersResponde(fila())],
    ["a lookup that fails", () => usersResponde(null, { message: "boom" })],
  ])("an invalid tenant slug is a 403 and the session is discarded, with %s", async (_caso, preparar) => {
    vi.mocked(auth).mockResolvedValue(sesion("TECNICO", "suc-A"))
    preparar()
    vi.mocked(headers).mockReturnValueOnce(conSlug("otro-taller"))
    vi.mocked(validateUserTenant).mockResolvedValueOnce(false)

    const r = await requireAuth()

    expect(r.error!.status).toBe(403)
    expect(r.session).toBeNull()
    expect(r.organizationId).toBeNull()
  })
})

describe("wrappers around requireAuth", () => {
  it.each([
    ["requireAdmin", requireAdmin, "TECNICO"],
    ["requireAdmin (ADMIN)", requireAdmin, "ADMIN"],
    ["requireAdminOrVendedor", requireAdminOrVendedor, "VENDEDOR"],
    ["requirePosAccess", requirePosAccess, "VENDEDOR"],
  ])("%s propagates the 500 when the lookup fails", async (_nombre, guard, role) => {
    vi.mocked(auth).mockResolvedValue(sesion(role, "suc-A"))
    usersResponde(null, { message: "connection reset" })

    const r = (await guard()) as any

    expect(r.error.status).toBe(500)
    expect(r.session).toBeNull()
  })

  it.each([
    ["requireAdminOrVendedor", requireAdminOrVendedor],
    ["requirePosAccess", requirePosAccess],
  ])("%s hands back the session with the DB branch", async (_nombre, guard) => {
    vi.mocked(auth).mockResolvedValue(sesion("VENDEDOR", "suc-A"))
    usersResponde(fila({ rol: "VENDEDOR" }))

    const r = (await guard()) as any

    expect(r.error).toBeNull()
    expect(r.session.user.sucursalId).toBe("suc-B")
  })
})

describe("existing callers get the fresh branch without edits", () => {
  it("GET /api/operadores scopes a moved TECNICO to the branch in the DB, not the one in the JWT", async () => {
    vi.mocked(auth).mockResolvedValue(sesion("TECNICO", "suc-A"))
    const lookup = createChainMock(fila())
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

  it("POST /api/turnos (write via sucursalParaEscritura) stamps the DB branch, not the JWT one", async () => {
    vi.mocked(auth).mockResolvedValue(sesion("TECNICO", "suc-A"))
    const inicio = new Date(Date.now() + 3600 * 1000).toISOString()
    const insertado = {
      id: "turno-1", organization_id: "org-1", sucursal_id: "suc-B", cliente_id: "cliente-1",
      tecnico_id: "user-1", inicio, fin: null, tipo: "visita_diagnostico", estado: "agendado",
      fotos_previas: [], created_by: "user-1", serie_id: null, recurrencia: null,
      clientes: null, users: null, ordenes_servicio: null,
    }
    // The route reads turnos twice: the overlap pre-check, then the insert.
    const sinConflictos = createChainMock([])
    const insertChain = createChainMock([insertado])
    const turnos: any = {
      select: vi.fn().mockReturnValue(sinConflictos),
      insert: vi.fn().mockReturnValue(insertChain),
    }
    vi.mocked(supabaseAdmin.from).mockImplementation(((tabla: string) => {
      if (tabla === "users") return createChainMock(fila({ sucursal_id: "suc-B" }))
      if (tabla === "organizations") return createChainMock({ modulo_agenda: true })
      if (tabla === "clientes") return createChainMock({ id: "cliente-1" })
      if (tabla === "sucursales") return createChainMock({ id: "suc-principal" })
      if (tabla === "turnos") return turnos
      return createChainMock(null)
    }) as any)

    const res = await postTurno(createPostRequest({ clienteId: "cliente-1", inicio, tipo: "visita_diagnostico" }))

    expect(res.status).toBe(201)
    const filas = turnos.insert.mock.calls[0][0]
    expect(filas[0]).toMatchObject({ sucursal_id: "suc-B", tecnico_id: "user-1" })
  })
})

describe("sesionConSucursalVigente — server pages that call auth() directly", () => {
  it("returns the session with the DB branch for a non-admin", async () => {
    vi.mocked(auth).mockResolvedValue(sesion("TECNICO", "suc-A"))
    usersResponde(fila())

    const s = await sesionConSucursalVigente()

    expect(s!.user.sucursalId).toBe("suc-B")
    expect(s!.user.id).toBe("user-1")
  })

  it("returns null without a session, and null when the row does not exist", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)
    expect(await sesionConSucursalVigente()).toBeNull()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()

    vi.mocked(auth).mockResolvedValue(sesion("VENDEDOR", "suc-A"))
    usersResponde(null)
    expect(await sesionConSucursalVigente()).toBeNull()
  })

  it("ADMIN is verified and returned untouched; a demoted ADMIN is null", async () => {
    const admin = sesion("ADMIN", null)
    vi.mocked(auth).mockResolvedValue(admin)
    usersResponde(fila({ rol: "ADMIN", sucursal_id: null }))
    expect(await sesionConSucursalVigente()).toBe(admin)

    clearSesionSucursalCache()
    usersResponde(fila({ rol: "TECNICO" }))
    expect(await sesionConSucursalVigente()).toBeNull()
  })

  it("throws when the lookup fails: a page must not render on a guessed branch", async () => {
    vi.mocked(auth).mockResolvedValue(sesion("TECNICO", "suc-A"))
    usersResponde(null, { message: "connection reset" })

    await expect(sesionConSucursalVigente()).rejects.toThrow()
  })
})
