// @vitest-environment node
/**
 * GET / PUT /api/usuarios/[id]/sucursal — "Mover de sucursal" (sucursales-aislamiento,
 * BM-2 / BM-3). An ADMIN moves a TECNICO/VENDEDOR to another active branch of the org.
 *
 *   1. The move governs the user's NEXT request: the route only writes
 *      `users.sucursal_id` (requireAuth re-reads it per request) and must not cut the session.
 *   2. Orders stay where they are (BM-3): the route never writes `ordenes_servicio`;
 *      GET only reports them so the form can warn first.
 *   3. ADMIN-only, org-scoped, never targets an ADMIN.
 *
 * `@/lib/sesion-sucursal` is un-mocked so the last test can prove (1) end to end.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth, invalidateRefreshToken } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { ESTADOS_ACTIVOS } from "@/lib/order-states"
import { mockAuthSuccess, createChainMock, parseResponse } from "./helpers"

vi.unmock("@/lib/sesion-sucursal")

import { requireAuth } from "@/lib/auth-utils"
import { GET, PUT } from "@/app/api/usuarios/[id]/sucursal/route"

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const getReq = (id: string) => new Request(`http://localhost/api/usuarios/${id}/sucursal`)
const putJson = (id: string, body: unknown) =>
  new Request(`http://localhost/api/usuarios/${id}/sucursal`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
const mover = async (id = "u-2", body: unknown = { sucursalId: "suc-B" }) =>
  parseResponse((await PUT(putJson(id, body), ctx(id))) as Response)
const leer = async (id = "u-2") => parseResponse((await GET(getReq(id), ctx(id))) as Response)

function usuario(overrides: Record<string, any> = {}) {
  return {
    id: "u-2",
    nombre: "Juan",
    rol: "TECNICO",
    organization_id: "org-1",
    sucursal_id: "suc-A",
    deleted_at: null,
    ...overrides,
  }
}

const NOMBRES = [
  { id: "suc-A", nombre: "Tablada" },
  { id: "suc-B", nombre: "San Justo" },
]

/** An awaitable resolving to `rows` (how a `.in(...)` names query ends). */
const resuelve = (rows: unknown) => ({
  then: (res: any, rej?: any) => Promise.resolve({ data: rows, error: null }).then(res, rej),
})

/**
 * Wires `supabaseAdmin.from` per table. `destinoValida` is what the branch check
 * (`assertSucursalEnOrg`, a `.single()` on `sucursales`) finds; the same table
 * also answers the names query that ends in `.in(...)`.
 */
function mockDb(
  opts: {
    target?: Record<string, any> | null
    ordenes?: Array<{ sucursal_id: string | null }>
    ordenesError?: unknown
    destinoValida?: boolean
    updateError?: unknown
    auditError?: unknown
  } = {},
) {
  const usersChain: any = createChainMock("target" in opts ? opts.target : usuario())
  const updateChain = createChainMock(null, opts.updateError ?? null)
  usersChain.update = vi.fn().mockReturnValue(updateChain)
  const ordenesChain = createChainMock(opts.ordenes ?? [], opts.ordenesError ?? null)
  const sucursalesChain: any = createChainMock(opts.destinoValida === false ? null : { id: "suc-B" })
  sucursalesChain.in = vi.fn().mockReturnValue(resuelve(NOMBRES))
  const auditChain = createChainMock(null, opts.auditError ?? null)

  vi.mocked(supabaseAdmin.from).mockImplementation((tabla: string) => {
    const porTabla: Record<string, unknown> = {
      users: usersChain,
      ordenes_servicio: ordenesChain,
      sucursales: sucursalesChain,
      audit_logs: auditChain,
    }
    return (porTabla[tabla] ?? createChainMock(null)) as any
  })
  return { usersChain, updateChain, ordenesChain, sucursalesChain, auditChain }
}

const tablasTocadas = () => vi.mocked(supabaseAdmin.from).mock.calls.map((c) => c[0] as string)

/** Targets the route must refuse, with the status each one gets. */
const OBJETIVOS_INVALIDOS: Array<[string, Record<string, any> | null, number]> = [
  ["a user of ANOTHER organization is a 404, never a 403", usuario({ organization_id: "org-ajena" }), 404],
  ["a nonexistent user is the same 404", null, 404],
  ["a deleted user is the same 404", usuario({ deleted_at: "2026-01-01T00:00:00Z" }), 404],
  ["an ADMIN has no branch to move: 400", usuario({ rol: "ADMIN", sucursal_id: null }), 400],
]

describe("GET /api/usuarios/[id]/sucursal — open orders the move would leave behind", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "u-admin" })
  })

  it("groups the user's open assigned orders by the branch they live in", async () => {
    // The jed-electronics case: orders sit in a different branch than the user.
    const { ordenesChain } = mockDb({
      ordenes: [...Array(4).fill({ sucursal_id: "suc-A" }), { sucursal_id: "suc-B" }],
    })

    const { status, body } = await leer()

    expect(status).toBe(200)
    expect(body.usuario).toEqual({ id: "u-2", nombre: "Juan", rol: "TECNICO", sucursalId: "suc-A" })
    expect(body.ordenesAbiertas).toEqual([
      { sucursalId: "suc-A", sucursalNombre: "Tablada", cantidad: 4 },
      { sucursalId: "suc-B", sucursalNombre: "San Justo", cantidad: 1 },
    ])
    expect(body.totalOrdenesAbiertas).toBe(5)
    // "Open" = every non-terminal state, from the shared constant; scoped to org + assignee.
    expect(ordenesChain.select).toHaveBeenCalledWith("sucursal_id")
    expect(ordenesChain.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(ordenesChain.eq).toHaveBeenCalledWith("tecnico_id", "u-2")
    expect(ordenesChain.in).toHaveBeenCalledWith("estado", ESTADOS_ACTIVOS)
  })

  it("reports nothing to warn about without open orders, and resolves no branch names", async () => {
    mockDb({ ordenes: [] })

    const { status, body } = await leer()

    expect(status).toBe(200)
    expect(body.ordenesAbiertas).toEqual([])
    expect(body.totalOrdenesAbiertas).toBe(0)
    expect(tablasTocadas()).not.toContain("sucursales")
  })

  it("keeps an order without a branch as its own unnamed group instead of dropping it", async () => {
    mockDb({ ordenes: [{ sucursal_id: null }, { sucursal_id: "suc-A" }, { sucursal_id: null }] })

    const { body } = await leer()

    expect(body.totalOrdenesAbiertas).toBe(3)
    expect(body.ordenesAbiertas).toEqual([
      { sucursalId: null, sucursalNombre: null, cantidad: 2 },
      { sucursalId: "suc-A", sucursalNombre: "Tablada", cantidad: 1 },
    ])
  })

  it.each(["TECNICO", "VENDEDOR"])("%s gets 403 and no order is read", async (role) => {
    mockAuthSuccess({ role, organizationId: "org-1", userId: "u-v", sucursalId: "suc-A" })
    mockDb()

    expect((await leer()).status).toBe(403)
    expect(tablasTocadas()).not.toContain("ordenes_servicio")
  })

  it.each(OBJETIVOS_INVALIDOS)("%s", async (_nombre, target, esperado) => {
    mockDb({ target })

    expect((await leer()).status).toBe(esperado)
    expect(tablasTocadas()).not.toContain("ordenes_servicio")
  })

  it("answers 500 when the orders query fails (never an empty list that hides the warning)", async () => {
    mockDb({ ordenesError: { message: "connection reset" } })

    const { status, body } = await leer()

    expect(status).toBe(500)
    expect(body.ordenesAbiertas).toBeUndefined()
  })
})

describe("PUT /api/usuarios/[id]/sucursal — move a user", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "u-admin" })
  })

  it.each(["TECNICO", "VENDEDOR"])(
    "moves a %s writing ONLY users.sucursal_id: no order is touched and the session stays alive",
    async (rol) => {
      const { usersChain, updateChain } = mockDb({ target: usuario({ rol }) })

      const { status, body } = await mover()

      expect(status).toBe(200)
      expect(body).toMatchObject({ success: true, sucursalId: "suc-B" })
      // Exactly one column, scoped to the user and the org.
      expect(usersChain.update).toHaveBeenCalledTimes(1)
      expect(usersChain.update).toHaveBeenCalledWith({ sucursal_id: "suc-B" })
      expect(updateChain.eq).toHaveBeenCalledWith("id", "u-2")
      expect(updateChain.eq).toHaveBeenCalledWith("organization_id", "org-1")
      // BM-3: no order changes. And NO re-login (the rol route cuts the session; this must not).
      expect(tablasTocadas()).not.toContain("ordenes_servicio")
      expect(invalidateRefreshToken).not.toHaveBeenCalled()
    },
  )

  it("the write also guards the role, so a user promoted to ADMIN in between never gets a branch", async () => {
    const { updateChain } = mockDb()

    await mover()

    expect(updateChain.in).toHaveBeenCalledWith("rol", ["TECNICO", "VENDEDOR"])
  })

  it("records who moved whom, from which branch to which", async () => {
    const { auditChain } = mockDb()

    await mover()

    expect(auditChain.insert).toHaveBeenCalledTimes(1)
    const fila = auditChain.insert.mock.calls[0][0]
    expect(fila).toMatchObject({
      organization_id: "org-1",
      user_id: "u-admin",
      action: "UPDATE",
      entity: "users",
      entity_id: "u-2",
    })
    expect(fila.changes).toMatchObject({ field: "sucursal_id", before: "suc-A", after: "suc-B" })
    for (const parte of ["Juan", "Tablada", "San Justo"]) expect(fila.changes.action_description).toContain(parte)
  })

  it("a failed audit insert does not fail a move that already happened", async () => {
    mockDb({ auditError: { message: "audit down" } })

    expect((await mover()).status).toBe(200)
  })

  it.each(["TECNICO", "VENDEDOR"])("%s gets 403 and nothing is written", async (role) => {
    mockAuthSuccess({ role, organizationId: "org-1", userId: "u-v", sucursalId: "suc-A" })
    const { usersChain } = mockDb()

    expect((await mover()).status).toBe(403)
    expect(usersChain.update).not.toHaveBeenCalled()
    expect(tablasTocadas()).not.toContain("sucursales")
  })

  it.each(OBJETIVOS_INVALIDOS)("%s, and nothing is written", async (_nombre, target, esperado) => {
    const { usersChain } = mockDb({ target })

    expect((await mover()).status).toBe(esperado)
    expect(usersChain.update).not.toHaveBeenCalled()
    expect(tablasTocadas()).not.toContain("sucursales")
  })

  it("rejects an inactive or foreign branch with 400: the check is org-scoped and active-only", async () => {
    // `destinoValida: false` = what the lookup finds for an inactive, deleted or foreign branch.
    const { usersChain, sucursalesChain } = mockDb({ destinoValida: false })

    const { status, body } = await mover("u-2", { sucursalId: "suc-X" })

    expect(status).toBe(400)
    expect(body.error).toMatch(/sucursal/i)
    expect(sucursalesChain.eq).toHaveBeenCalledWith("id", "suc-X")
    expect(sucursalesChain.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(sucursalesChain.eq).toHaveBeenCalledWith("activo", true)
    expect(usersChain.update).not.toHaveBeenCalled()
  })

  it("moving to the branch the user is already in is a 400 no-op", async () => {
    const { usersChain } = mockDb({ target: usuario({ sucursal_id: "suc-B" }) })

    const { status, body } = await mover()

    expect(status).toBe(400)
    expect(body.error).toContain("Juan")
    expect(usersChain.update).not.toHaveBeenCalled()
  })

  it.each([{}, { sucursalId: null }, { sucursalId: "" }, { sucursalId: 7 }])(
    "a body without a usable sucursalId (%j) is a 400: clearing the branch is not an option",
    async (body) => {
      const { usersChain } = mockDb()

      expect((await mover("u-2", body)).status).toBe(400)
      expect(usersChain.update).not.toHaveBeenCalled()
    },
  )

  it("answers 500 when the update fails, with no audit row for a move that did not happen", async () => {
    const { auditChain } = mockDb({ updateError: { message: "boom" } })

    expect((await mover()).status).toBe(500)
    expect(auditChain.insert).not.toHaveBeenCalled()
  })
})

describe("PUT /api/usuarios/[id]/sucursal — the moved user's next request", () => {
  /** A tiny in-memory `users` table: update really changes what the next read returns. */
  function usersEnMemoria(filas: Array<Record<string, any>>) {
    const consulta = (extra: (q: any, filtros: Array<(f: any) => boolean>) => void) => {
      const filtros: Array<(f: any) => boolean> = []
      const q: any = {
        eq: (c: string, v: unknown) => (filtros.push((f) => f[c] === v), q),
        in: (c: string, vs: unknown[]) => (filtros.push((f) => vs.includes(f[c])), q),
      }
      extra(q, filtros)
      return q
    }
    const coinciden = (filtros: Array<(f: any) => boolean>) => filas.filter((f) => filtros.every((p) => p(f)))
    return {
      select: () =>
        consulta((q, filtros) => {
          q.maybeSingle = async () => ({ data: coinciden(filtros)[0] ?? null, error: null })
        }),
      update: (payload: Record<string, unknown>) =>
        consulta((q, filtros) => {
          q.then = (res: any, rej?: any) => {
            coinciden(filtros).forEach((f) => Object.assign(f, payload))
            return Promise.resolve({ data: null, error: null }).then(res, rej)
          }
        }),
    }
  }

  beforeEach(() => vi.clearAllMocks())

  it("after the ADMIN moves a TECNICO, requireAuth() scopes them to the new branch without a new login", async () => {
    const users = usersEnMemoria([usuario({ id: "u-2", sucursal_id: "suc-A" })])
    const sucursales: any = createChainMock({ id: "suc-B" })
    sucursales.in = vi.fn().mockReturnValue(resuelve(NOMBRES))
    vi.mocked(supabaseAdmin.from).mockImplementation(((tabla: string) =>
      tabla === "users" ? users : tabla === "sucursales" ? sucursales : createChainMock(null)) as any)

    // The JWT the technician carries was signed while they were still in suc-A.
    const jwtDelTecnico = {
      user: { id: "u-2", organizationId: "org-1", role: "TECNICO", sucursalId: "suc-A", email: "t@test.com" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as any
    vi.mocked(auth).mockResolvedValue(jwtDelTecnico)
    expect((await requireAuth()).session!.user.sucursalId).toBe("suc-A")

    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "u-admin" })
    expect((await mover()).status).toBe(200)

    vi.mocked(auth).mockResolvedValue(jwtDelTecnico) // the same, now stale, token
    const siguiente = await requireAuth()
    expect(siguiente.error).toBeNull()
    expect(siguiente.session!.user.sucursalId).toBe("suc-B")
    expect(invalidateRefreshToken).not.toHaveBeenCalled()
  })
})
