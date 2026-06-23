/**
 * Tests: Técnico double-booking prevention for POST /api/turnos
 *
 * Scenarios:
 *  T3.1 — Overlapping active turno for same técnico → 409 (app pre-check)
 *  T3.2 — Insert returns Postgres error code 23P01 (exclusion_violation) → 409
 *  T3.3 — Non-overlapping turno → 201
 *  T3.4 — Existing 'cancelado' turno at same time for same técnico → NOT blocked (201)
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { cookies } from "next/headers"
import { mockSupabaseFrom, createChainMock, createPostRequest } from "./helpers"
import { POST } from "@/app/api/turnos/route"

// ─── Cookie mock ─────────────────────────────────────────────────────────────

function mockCookie(value: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) =>
      name === "stapp-sucursal-activa" && value ? { value } : undefined
    ),
    set: vi.fn(),
  } as any)
}

// ─── Auth mock ───────────────────────────────────────────────────────────────

function mockAuthAdmin(opts: { userId?: string; organizationId?: string } = {}) {
  vi.mocked(auth).mockResolvedValue({
    user: {
      id: opts.userId ?? "user-admin-1",
      organizationId: opts.organizationId ?? "org-1",
      role: "ADMIN",
      sucursalId: "suc-A",
      email: "admin@test.com",
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const TECNICO_ID = "tec-99"
const ORG_ID = "org-1"
const SUCURSAL_ID = "suc-A"

// A turno starting 1 hour from now, lasting 1 hour.
const now = new Date("2026-06-23T10:00:00Z")
const inicio = new Date(now.getTime() + 3600 * 1000).toISOString() // 11:00
const fin = new Date(now.getTime() + 2 * 3600 * 1000).toISOString() // 12:00

const turnoBody = {
  clienteId: "cliente-1",
  tecnicoId: TECNICO_ID,
  inicio,
  fin,
  tipo: "visita_diagnostico",
}

function makeFakeInserted(overrides: Record<string, any> = {}) {
  return [{
    id: "turno-new-1",
    organization_id: ORG_ID,
    sucursal_id: SUCURSAL_ID,
    cliente_id: "cliente-1",
    cliente_snapshot: null,
    tecnico_id: TECNICO_ID,
    inicio,
    fin,
    direccion: null,
    tipo: "visita_diagnostico",
    tipo_dispositivo: null,
    marca: null,
    modelo: null,
    problema_reportado: null,
    fotos_previas: [],
    estado: "agendado",
    orden_id: null,
    notas: null,
    created_by: "user-admin-1",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    serie_id: null,
    recurrencia: null,
    clientes: null,
    users: null,
    ordenes_servicio: null,
    ...overrides,
  }]
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/turnos — técnico double-booking prevention", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthAdmin()
    mockCookie("suc-A")
  })

  it("T3.1 — overlapping active turno for same técnico → 409", async () => {
    // The overlap pre-check query returns an existing active turno
    const conflictingTurno = {
      id: "turno-existing-1",
      inicio: inicio,
      fin: fin,
      estado: "agendado",
    }
    const overlapCheckChain = createChainMock([conflictingTurno])

    // turnosChain handles both the pre-check SELECT and the INSERT
    // We need different responses for select vs insert calls on "turnos"
    // Use a chain where the first call (overlap check) returns conflict data
    // and insert is never reached (409 returned early).
    const turnosChain = createChainMock([conflictingTurno])

    mockSupabaseFrom({
      organizations: createChainMock({ modulo_agenda: true }),
      users: createChainMock({ id: TECNICO_ID }), // tecnico validation
      clientes: createChainMock({ id: "cliente-1" }),
      sucursales: createChainMock({ id: SUCURSAL_ID }),
      turnos: turnosChain,
    })

    const res = await POST(createPostRequest(turnoBody))

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/técnico|horario/i)
  })

  it("T3.2 — insert returns Postgres exclusion_violation (23P01) → 409 not 500", async () => {
    // Overlap pre-check returns no conflicts (empty array)
    // But the INSERT itself fails with 23P01
    const emptyChain = createChainMock([]) // overlap pre-check: no conflicts

    // We need turnos to return empty for the SELECT (overlap check) but error for INSERT.
    // We'll create a chain that tracks calls and varies response.
    let callCount = 0
    const turnosChain: any = {}
    const subchain: any = {}

    // All chainable methods return a sub-chain
    const chainMethods = [
      "select", "insert", "update", "upsert", "delete",
      "eq", "neq", "not", "gte", "lte", "gt", "lt",
      "or", "in", "is", "ilike", "textSearch",
      "order", "limit", "range", "maybeSingle",
    ]

    // Build two separate response chains
    const selectChain = createChainMock([]) // overlap check → no conflicts
    const insertChain = createChainMock(null, { code: "23P01", message: "conflicting key value violates exclusion constraint" })

    turnosChain.select = vi.fn().mockReturnValue(selectChain)
    turnosChain.insert = vi.fn().mockReturnValue(insertChain)

    // Make sure the select chain is properly thenable
    selectChain.then = (resolve: any, reject?: any) =>
      Promise.resolve({ data: [], error: null }).then(resolve, reject)

    // Make insert chain thenable with error
    insertChain.then = (resolve: any, reject?: any) =>
      Promise.resolve({ data: null, error: { code: "23P01", message: "conflicting key value violates exclusion constraint" } }).then(resolve, reject)

    mockSupabaseFrom({
      organizations: createChainMock({ modulo_agenda: true }),
      users: createChainMock({ id: TECNICO_ID }),
      clientes: createChainMock({ id: "cliente-1" }),
      sucursales: createChainMock({ id: SUCURSAL_ID }),
      turnos: turnosChain,
    })

    const res = await POST(createPostRequest(turnoBody))

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/técnico|horario/i)
  })

  it("T3.3 — non-overlapping turno → 201 created", async () => {
    // Overlap pre-check returns empty (no conflicts)
    const turnosChain: any = {}
    const selectChain = createChainMock([]) // no overlap
    const insertChain = createChainMock(makeFakeInserted())

    turnosChain.select = vi.fn().mockReturnValue(selectChain)
    turnosChain.insert = vi.fn().mockReturnValue(insertChain)

    selectChain.then = (resolve: any, reject?: any) =>
      Promise.resolve({ data: [], error: null }).then(resolve, reject)

    insertChain.then = (resolve: any, reject?: any) =>
      Promise.resolve({ data: makeFakeInserted(), error: null }).then(resolve, reject)

    mockSupabaseFrom({
      organizations: createChainMock({ modulo_agenda: true }),
      users: createChainMock({ id: TECNICO_ID }),
      clientes: createChainMock({ id: "cliente-1" }),
      sucursales: createChainMock({ id: SUCURSAL_ID }),
      turnos: turnosChain,
    })

    const res = await POST(createPostRequest(turnoBody))

    expect(res.status).toBe(201)
  })

  it("T3.4 — existing 'cancelado' turno at same slot for same técnico → NOT blocked (201)", async () => {
    // Overlap pre-check should EXCLUDE 'cancelado' turnos, so returns empty
    const turnosChain: any = {}
    const selectChain = createChainMock([]) // cancelado turno filtered out
    const insertChain = createChainMock(makeFakeInserted())

    turnosChain.select = vi.fn().mockReturnValue(selectChain)
    turnosChain.insert = vi.fn().mockReturnValue(insertChain)

    selectChain.then = (resolve: any, reject?: any) =>
      Promise.resolve({ data: [], error: null }).then(resolve, reject)

    insertChain.then = (resolve: any, reject?: any) =>
      Promise.resolve({ data: makeFakeInserted(), error: null }).then(resolve, reject)

    mockSupabaseFrom({
      organizations: createChainMock({ modulo_agenda: true }),
      users: createChainMock({ id: TECNICO_ID }),
      clientes: createChainMock({ id: "cliente-1" }),
      sucursales: createChainMock({ id: SUCURSAL_ID }),
      turnos: turnosChain,
    })

    const res = await POST(createPostRequest(turnoBody))

    expect(res.status).toBe(201)

    // Verify the pre-check query explicitly excludes cancelado/no_show
    const selectCall = vi.mocked(turnosChain.select).mock.calls[0]
    // The select was called — and the chain should have called .not() or .in() to exclude estados
    // We verify via the selectChain method calls
    // The route must call .not("estado", "in", ...) or similar
    // Check that neq/not/in was called on the selectChain with estado
    const notCalls = (vi.mocked(selectChain.not).mock.calls as any[][])
    const inCalls = (vi.mocked(selectChain.in).mock.calls as any[][])

    // Either .not() or .in() must have been used to exclude terminal estados
    const hasEstadoFilter =
      notCalls.some((c) => c[0] === "estado") ||
      inCalls.some((c) => c[0] === "estado")

    expect(hasEstadoFilter).toBe(true)
  })
})
