// @vitest-environment node
/**
 * GET / PUT /api/usuarios/[id]/sucursal — "Mover de sucursal" (sucursales-aislamiento,
 * BM-2 / BM-3). An ADMIN moves a TECNICO/VENDEDOR to another active branch of the org.
 *
 *   1. The move governs the user's following requests without a new login: the route only
 *      writes `users.sucursal_id` and requireAuth() re-reads it (cached ~5 s per instance),
 *      so it applies within a few seconds. The route must not cut the session.
 *   2. Orders stay where they are (BM-3): the route never writes `ordenes_servicio`;
 *      GET only reports them (plus appointments and an open cash session) so the form can
 *      warn first. An open cash session blocks the move, because the user could not close
 *      it from the new branch.
 *   3. ADMIN-only, org-scoped, never targets an ADMIN, and the write is conditional on the
 *      row still being what was read.
 *
 * `@/lib/sesion-sucursal` is un-mocked so the last test can prove (1) end to end; its cache
 * outlives a test, hence the clear in `beforeEach`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth, invalidateRefreshToken } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { ESTADOS_ACTIVOS } from "@/lib/order-states"
import { mockAuthSuccess, createChainMock, parseResponse } from "./helpers"

vi.unmock("@/lib/sesion-sucursal")

import { clearSesionSucursalCache } from "@/lib/sesion-sucursal"
import { requireAuth } from "@/lib/auth-utils"
import { GET, PUT } from "@/app/api/usuarios/[id]/sucursal/route"

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const url = (id: string) => `http://localhost/api/usuarios/${id}/sucursal`
const getReq = (id: string) => new Request(url(id))
const putRaw = (id: string, body: string) =>
  new Request(url(id), { method: "PUT", headers: { "Content-Type": "application/json" }, body })
const mover = async (id = "u-2", body: unknown = { sucursalId: "suc-B" }) =>
  parseResponse((await PUT(putRaw(id, JSON.stringify(body)), ctx(id))) as Response)
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
const resuelve = (rows: unknown, error: unknown = null) => ({
  then: (res: any, rej?: any) => Promise.resolve({ data: rows, error }).then(res, rej),
})

/**
 * Wires `supabaseAdmin.from` per table. `destinoValida` is what the branch check
 * (`assertSucursalEnOrg`, a `.single()` on `sucursales`) finds; the same table also
 * answers the names query that ends in `.in(...)`. `updateRows` is what the conditional
 * UPDATE reports as written (`.select("id")`): empty means the guard matched no row.
 */
function mockDb(
  opts: {
    target?: Record<string, any> | null
    readError?: unknown
    ordenes?: Array<{ sucursal_id: string | null }>
    ordenesError?: unknown
    turnos?: Array<{ sucursal_id: string | null }>
    turnosError?: unknown
    caja?: Array<{ id: string; sucursal_id: string }>
    cajaError?: unknown
    destinoValida?: boolean
    nombresError?: unknown
    updateRows?: Array<{ id: string }>
    updateError?: unknown
    auditError?: unknown
  } = {},
) {
  const usersChain: any = createChainMock("target" in opts ? opts.target : usuario(), opts.readError ?? null)
  const updateChain = createChainMock(opts.updateRows ?? [{ id: "u-2" }], opts.updateError ?? null)
  usersChain.update = vi.fn().mockReturnValue(updateChain)
  const ordenesChain = createChainMock(opts.ordenes ?? [], opts.ordenesError ?? null)
  const turnosChain = createChainMock(opts.turnos ?? [], opts.turnosError ?? null)
  const cajaChain = createChainMock(opts.caja ?? [], opts.cajaError ?? null)
  const sucursalesChain: any = createChainMock(opts.destinoValida === false ? null : { id: "suc-B" })
  sucursalesChain.in = vi
    .fn()
    .mockReturnValue(opts.nombresError ? resuelve(null, opts.nombresError) : resuelve(NOMBRES))
  const auditChain = createChainMock(null, opts.auditError ?? null)

  vi.mocked(supabaseAdmin.from).mockImplementation((tabla: string) => {
    const porTabla: Record<string, unknown> = {
      users: usersChain,
      ordenes_servicio: ordenesChain,
      turnos: turnosChain,
      sesiones_caja: cajaChain,
      sucursales: sucursalesChain,
      audit_logs: auditChain,
    }
    return (porTabla[tabla] ?? createChainMock(null)) as any
  })
  return { usersChain, updateChain, ordenesChain, turnosChain, cajaChain, sucursalesChain, auditChain }
}

const tablasTocadas = () => vi.mocked(supabaseAdmin.from).mock.calls.map((c) => c[0] as string)

/** Targets the route must refuse, with the status each one gets. */
const OBJETIVOS_INVALIDOS: Array<[string, Record<string, any> | null, number]> = [
  ["a user of ANOTHER organization is a 404, never a 403", usuario({ organization_id: "org-ajena" }), 404],
  ["a nonexistent user is the same 404", null, 404],
  ["a deleted user is the same 404", usuario({ deleted_at: "2026-01-01T00:00:00Z" }), 404],
  ["an ADMIN has no branch to move: 400", usuario({ rol: "ADMIN", sucursal_id: null }), 400],
]

beforeEach(() => clearSesionSucursalCache())

describe("GET /api/usuarios/[id]/sucursal — what the move would leave behind", () => {
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

  it("breaks a tie on the count by branch name, not by the order rows arrived in", async () => {
    // suc-A (Tablada) arrives first; alphabetically San Justo (suc-B) goes first.
    mockDb({ ordenes: [{ sucursal_id: "suc-A" }, { sucursal_id: "suc-B" }] })

    const { body } = await leer()

    expect(body.ordenesAbiertas.map((g: any) => g.sucursalNombre)).toEqual(["San Justo", "Tablada"])
  })

  it("reports the appointments still ahead and the open cash session the move would strand", async () => {
    const { turnosChain, cajaChain } = mockDb({
      turnos: [{ sucursal_id: "suc-A" }, { sucursal_id: "suc-A" }],
      caja: [{ id: "ses-1", sucursal_id: "suc-A" }],
    })

    const { status, body } = await leer()

    expect(status).toBe(200)
    expect(body.turnosPendientes).toEqual([{ sucursalId: "suc-A", sucursalNombre: "Tablada", cantidad: 2 }])
    expect(body.totalTurnosPendientes).toBe(2)
    expect(body.cajaAbierta).toEqual({ sesionId: "ses-1", sucursalId: "suc-A", sucursalNombre: "Tablada" })
    // Pending = not cancelled/no-show/done, and still in the future; scoped to org + technician.
    expect(turnosChain.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(turnosChain.eq).toHaveBeenCalledWith("tecnico_id", "u-2")
    expect(turnosChain.in).toHaveBeenCalledWith("estado", ["agendado", "confirmado", "en_camino"])
    expect(turnosChain.gte).toHaveBeenCalledWith("inicio", expect.any(String))
    // Only a session the user OPENED and that is still ABIERTA.
    expect(cajaChain.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(cajaChain.eq).toHaveBeenCalledWith("usuario_apertura_id", "u-2")
    expect(cajaChain.eq).toHaveBeenCalledWith("estado", "ABIERTA")
  })

  it("reports nothing to warn about without open work, and resolves no branch names", async () => {
    mockDb({ ordenes: [], turnos: [], caja: [] })

    const { status, body } = await leer()

    expect(status).toBe(200)
    expect(body.ordenesAbiertas).toEqual([])
    expect(body.totalOrdenesAbiertas).toBe(0)
    expect(body.turnosPendientes).toEqual([])
    expect(body.totalTurnosPendientes).toBe(0)
    expect(body.cajaAbierta).toBeNull()
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

  it.each(["TECNICO", "VENDEDOR"])("%s gets 403 and nothing is read", async (role) => {
    mockAuthSuccess({ role, organizationId: "org-1", userId: "u-v", sucursalId: "suc-A" })
    mockDb({ target: usuario({ rol: role }) })

    expect((await leer()).status).toBe(403)
    expect(tablasTocadas()).not.toContain("ordenes_servicio")
  })

  it.each(OBJETIVOS_INVALIDOS)("%s", async (_nombre, target, esperado) => {
    mockDb({ target })

    expect((await leer()).status).toBe(esperado)
    expect(tablasTocadas()).not.toEqual(expect.arrayContaining(["ordenes_servicio"]))
    expect(tablasTocadas()).not.toContain("turnos")
    expect(tablasTocadas()).not.toContain("sesiones_caja")
  })

  it.each([
    ["the user read", { readError: { message: "connection reset" } }],
    ["the orders query", { ordenesError: { message: "connection reset" } }],
    ["the appointments query", { turnosError: { message: "connection reset" } }],
    ["the cash session query", { cajaError: { message: "connection reset" } }],
  ])("answers 500 when %s fails (never an all-clear that hides the warning)", async (_que, fallo) => {
    mockDb(fallo)

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
      expect(body.message).toContain("San Justo")
      // Exactly one column, scoped to the user and the org.
      expect(usersChain.update).toHaveBeenCalledTimes(1)
      expect(usersChain.update).toHaveBeenCalledWith({ sucursal_id: "suc-B" })
      expect(updateChain.eq).toHaveBeenCalledWith("id", "u-2")
      expect(updateChain.eq).toHaveBeenCalledWith("organization_id", "org-1")
      // BM-3: no order or appointment changes. And NO re-login (the rol route cuts the session).
      expect(tablasTocadas()).not.toContain("ordenes_servicio")
      expect(tablasTocadas()).not.toContain("turnos")
      expect(invalidateRefreshToken).not.toHaveBeenCalled()
    },
  )

  it("promises a few seconds, not an instant effect (the branch lookup is cached)", async () => {
    mockDb()

    const { body } = await mover()

    expect(body.message).toMatch(/unos segundos/)
    expect(body.message).not.toMatch(/próxima acción|inmediat/i)
  })

  it("the write is conditional on the row still being what was read", async () => {
    const { updateChain } = mockDb()

    await mover()

    // Not promoted to ADMIN, not deleted, and still in the branch we read.
    expect(updateChain.in).toHaveBeenCalledWith("rol", ["TECNICO", "VENDEDOR"])
    expect(updateChain.is).toHaveBeenCalledWith("deleted_at", null)
    expect(updateChain.eq).toHaveBeenCalledWith("sucursal_id", "suc-A")
    expect(updateChain.select).toHaveBeenCalledWith("id")
  })

  it("a user with no branch yet is guarded with IS NULL, not with a comparison to null", async () => {
    const { updateChain } = mockDb({ target: usuario({ sucursal_id: null }) })

    expect((await mover()).status).toBe(200)

    expect(updateChain.is).toHaveBeenCalledWith("sucursal_id", null)
    expect(updateChain.eq).not.toHaveBeenCalledWith("sucursal_id", expect.anything())
  })

  it("answers 409 and writes no audit row when the conditional update matched nothing", async () => {
    // Another request moved, promoted or deleted the user between our read and our write.
    const { auditChain } = mockDb({ updateRows: [] })

    const { status, body } = await mover()

    expect(status).toBe(409)
    expect(body.error).toBe("El usuario cambió mientras tanto. Recargá e intentá de nuevo.")
    expect(auditChain.insert).not.toHaveBeenCalled()
  })

  it("blocks the move with a 409 while the user has a cash session open, and writes nothing", async () => {
    // A non-admin cannot close a session outside their own branch, and that branch could not open another.
    const { usersChain, cajaChain, auditChain } = mockDb({ caja: [{ id: "ses-1", sucursal_id: "suc-A" }] })

    const { status, body } = await mover()

    expect(status).toBe(409)
    expect(body.error).toBe("Tiene una caja abierta en Tablada. Cerrala antes de moverlo.")
    expect(body.code).toBe("CAJA_ABIERTA")
    expect(cajaChain.eq).toHaveBeenCalledWith("usuario_apertura_id", "u-2")
    expect(cajaChain.eq).toHaveBeenCalledWith("estado", "ABIERTA")
    expect(usersChain.update).not.toHaveBeenCalled()
    expect(auditChain.insert).not.toHaveBeenCalled()
  })

  it("will not move on a guess: a failing cash session lookup is a 500 and nothing is written", async () => {
    const { usersChain } = mockDb({ cajaError: { message: "connection reset" } })

    expect((await mover()).status).toBe(500)
    expect(usersChain.update).not.toHaveBeenCalled()
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

  it("a failed audit insert does not fail a move that already happened, but is logged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mockDb({ auditError: { message: "audit down" } })

    expect((await mover()).status).toBe(200)

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("audit"), "audit down")
    warn.mockRestore()
  })

  it("never shows a raw branch id when the names lookup fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { auditChain } = mockDb({ nombresError: { message: "names down" } })

    const { status, body } = await mover()

    expect(status).toBe(200)
    expect(body.message).toContain("la nueva sucursal")
    expect(body.message).not.toContain("suc-B")
    expect(auditChain.insert.mock.calls[0][0].changes.action_description).not.toContain("suc-")
    warn.mockRestore()
  })

  it.each(["TECNICO", "VENDEDOR"])("%s gets 403 and nothing is written", async (role) => {
    mockAuthSuccess({ role, organizationId: "org-1", userId: "u-v", sucursalId: "suc-A" })
    const { usersChain } = mockDb({ target: usuario({ rol: role }) })

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

  it("a malformed JSON body is a 400 and nothing is read or written", async () => {
    const { usersChain } = mockDb()

    const res = (await PUT(putRaw("u-2", "{oops"), ctx("u-2"))) as Response

    expect(res.status).toBe(400)
    expect(usersChain.update).not.toHaveBeenCalled()
    expect(tablasTocadas()).not.toContain("sucursales")
  })

  it.each([
    ["reading the user", { readError: { message: "boom" } }],
    ["updating the user", { updateError: { message: "boom" } }],
  ])("answers 500 when %s fails, with no audit row for a move that did not happen", async (_cuando, fallo) => {
    const { auditChain } = mockDb(fallo)

    expect((await mover()).status).toBe(500)
    expect(auditChain.insert).not.toHaveBeenCalled()
  })
})

describe("PUT /api/usuarios/[id]/sucursal — the moved user's following requests", () => {
  /** A tiny in-memory `users` table: update really changes what the next read returns. */
  function usersEnMemoria(filas: Array<Record<string, any>>) {
    const consulta = (extra: (q: any, filtros: Array<(f: any) => boolean>) => void) => {
      const filtros: Array<(f: any) => boolean> = []
      const q: any = {
        eq: (c: string, v: unknown) => (filtros.push((f) => f[c] === v), q),
        is: (c: string, v: unknown) => (filtros.push((f) => f[c] === v), q),
        in: (c: string, vs: unknown[]) => (filtros.push((f) => vs.includes(f[c])), q),
        select: () => q,
      }
      extra(q, filtros)
      return q
    }
    const coinciden = (filtros: Array<(f: any) => boolean>) => filas.filter((f) => filtros.every((p) => p(f)))
    return {
      select: () =>
        consulta((q, filtros) => {
          // A copy, like a real response: the session cache must not alias the "table".
          q.maybeSingle = async () => ({ data: coinciden(filtros)[0] ? { ...coinciden(filtros)[0] } : null, error: null })
        }),
      update: (payload: Record<string, unknown>) =>
        consulta((q, filtros) => {
          q.then = (res: any, rej?: any) => {
            const tocadas = coinciden(filtros)
            tocadas.forEach((f) => Object.assign(f, payload))
            return Promise.resolve({ data: tocadas.map((f) => ({ id: f.id })), error: null }).then(res, rej)
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
      tabla === "users" ? users : tabla === "sucursales" ? sucursales : createChainMock([])) as any)

    // The JWT the technician carries was signed while they were still in suc-A.
    const jwtDelTecnico = {
      user: { id: "u-2", organizationId: "org-1", role: "TECNICO", sucursalId: "suc-A", email: "t@test.com" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as any
    vi.mocked(auth).mockResolvedValue(jwtDelTecnico)
    expect((await requireAuth()).session!.user.sucursalId).toBe("suc-A")

    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "u-admin" })
    expect((await mover()).status).toBe(200)

    // The lookup is cached for a few seconds per instance; clear it to stand for "a few seconds later".
    clearSesionSucursalCache()
    vi.mocked(auth).mockResolvedValue(jwtDelTecnico) // the same, now stale, token
    const siguiente = await requireAuth()
    expect(siguiente.error).toBeNull()
    expect(siguiente.session!.user.sucursalId).toBe("suc-B")
    expect(invalidateRefreshToken).not.toHaveBeenCalled()
  })
})
