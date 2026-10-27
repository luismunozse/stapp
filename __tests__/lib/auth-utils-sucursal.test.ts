// @vitest-environment node
/**
 * requireAuth() and the user's branch (sucursales-aislamiento, BM-2 / D1).
 *
 * `session.user.sucursalId` is signed into the JWT at login and only re-synced
 * in the last hours of the token's life, so a user moved to another branch kept
 * the old one for up to ~18 h. About 60 API files read that field and every one
 * of them gets it from requireAuth(), which makes it the single place to fix:
 * for a non-ADMIN it re-reads the user's row (branch, role, org, deletion mark)
 * with a 5 s per-instance cache.
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
import { clearSesionSucursalCache } from "@/lib/sesion-sucursal"
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

  it("a user whose row does not exist is a 401", async () => {
    vi.mocked(auth).mockResolvedValue(sesion("TECNICO", "suc-A"))
    usersResponde(null)

    const r = await requireAuth()

    expect(r.error!.status).toBe(401)
    expect(r.session).toBeNull()
  })
})

describe("requireAuth — a JWT that no longer matches the user's row is a 401", () => {
  it.each([
    ["the DB role changed (VENDEDOR in the JWT, TECNICO in the DB)", "VENDEDOR", fila({ rol: "TECNICO" })],
    ["the DB role was promoted to ADMIN", "TECNICO", fila({ rol: "ADMIN" })],
    ["the DB organization is another one", "TECNICO", fila({ organization_id: "org-2" })],
    ["the DB row has a null organization", "TECNICO", fila({ organization_id: null })],
    ["the user was deleted", "TECNICO", fila({ deleted_at: "2026-10-27T12:00:00Z" })],
  ])("%s", async (_caso, rolJwt, row) => {
    vi.mocked(auth).mockResolvedValue(sesion(rolJwt, "suc-A"))
    usersResponde(row)

    const r = await requireAuth()

    expect(r.error!.status).toBe(401)
    expect(r.session).toBeNull()
    expect(r.userId).toBeNull()
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
