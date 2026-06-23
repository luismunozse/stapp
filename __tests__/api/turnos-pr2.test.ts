/**
 * Tests for T2 (turno→orden atomic claim), T3 (monthly recurrence overflow),
 * T5 (turno state machine).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { cookies } from "next/headers"
import { createChainMock, createPostRequest, parseResponse } from "./helpers"

// ─── Module mocks (must be before imports that pull the routes) ───────────────

vi.mock("@/lib/plan-limits", () => ({
  enforcePlanLimit: vi.fn().mockResolvedValue(null),
  isPlanLimitError: vi.fn().mockReturnValue(false),
  planLimitErrorResponse: vi.fn(),
}))

vi.mock("@/lib/counters", () => ({
  getNextOrderNumberByType: vi.fn().mockResolvedValue({ codigo: "CEL-001", numero: 1 }),
}))

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock("@/lib/storage", () => ({
  uploadOrderPhoto: vi.fn().mockResolvedValue({ url: "http://example.com/photo.jpg", path: "photos/1.jpg" }),
  base64ToBuffer: vi.fn().mockReturnValue(Buffer.from("fake")),
}))

vi.mock("@/lib/push/send", () => ({
  sendPushToUsers: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/notifications/queue", () => ({
  queueNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/tipos-dispositivo-config", () => ({
  tipoValidaImei: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/turnos/notifications", () => ({
  notifyTurno: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/sucursal", () => ({
  sucursalParaEscritura: vi.fn().mockResolvedValue("suc-A"),
  sucursalParaLectura: vi.fn().mockResolvedValue({ verTodas: true, sucursalId: null }),
}))

// ─── Route imports (after vi.mock) ───────────────────────────────────────────
import { POST as postOrdenes } from "@/app/api/ordenes/route"
import { POST as postTurnos } from "@/app/api/turnos/route"
import { PATCH as patchTurno } from "@/app/api/turnos/[id]/route"
import { notifyTurno } from "@/lib/turnos/notifications"

// ─── Auth/cookie helpers ──────────────────────────────────────────────────────

function mockAuthAdmin(opts: { userId?: string; organizationId?: string; sucursalId?: string | null } = {}) {
  vi.mocked(auth).mockResolvedValue({
    user: {
      id: opts.userId ?? "user-admin-1",
      organizationId: opts.organizationId ?? "org-1",
      role: "ADMIN",
      sucursalId: opts.sucursalId ?? null,
      email: "admin@test.com",
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

function mockCookie(value: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) =>
      name === "stapp-sucursal-activa" && value ? { value } : undefined
    ),
    set: vi.fn(),
  } as any)
}

// ─── Minimal orden POST body (with fromTurnoId) ───────────────────────────────

const ordenBodyFromTurno = {
  clienteId: "cliente-1",
  dispositivo: "iPhone 13",
  tipoDispositivo: "CELULAR",
  problemaReportado: "Pantalla rota",
  fromTurnoId: "turno-1",
}

// Minimal turno row returned by the initial select
const fakeTurnoRow = {
  id: "turno-1",
  organization_id: "org-1",
  orden_id: null,
  tecnico_id: null,
  clientes: null,
  users: null,
  ordenes_servicio: null,
  inicio: new Date().toISOString(),
  fin: null,
  estado: "agendado",
}

// Minimal orden row returned by the insert
const fakeOrdenRow = {
  id: "orden-new-1",
  numero_orden: 1,
  codigo_orden: "CEL-001",
  organization_id: "org-1",
  sucursal_id: "suc-A",
  cliente_id: "cliente-1",
  tipo_dispositivo: "CELULAR",
  dispositivo: "iPhone 13",
  problema_reportado: "Pantalla rota",
  estado: "RECIBIDO",
  costo_final: null,
  sena: 0,
  metodo_pago_sena: "EFECTIVO",
  metadata: {},
  public_token: "abc123",
  fecha_prometida: null,
  observaciones: null,
  notas_internas: null,
  sector_id: null,
  tecnico_id: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  clientes: { id: "cliente-1", nombre: "Test Cliente", telefono: "123" },
}

// ─── T2 — Atomic turno claim ──────────────────────────────────────────────────

describe("T2 — POST /api/ordenes with fromTurnoId: atomic claim", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthAdmin()
    mockCookie(null)
  })

  it("T2-a: atomic claim returns 0 rows → 409 and orden is deleted", async () => {
    // Track which turnos call we're on
    let turnosCallCount = 0
    // We need to track delete calls on ordenes_servicio
    let ordenesDeleteChain: any

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "turnos") {
        turnosCallCount++
        if (turnosCallCount === 1) {
          // Initial select: turno exists with orden_id null
          return createChainMock(fakeTurnoRow) as any
        }
        // turnosCallCount === 2: atomic claim update returns 0 rows (already claimed)
        return createChainMock([], null) as any
      }
      if (table === "ordenes_servicio") {
        // We need to support both insert (returns orden) and delete (compensation)
        const chain: any = {}
        const methods = [
          "select", "insert", "update", "upsert", "delete",
          "eq", "neq", "not", "gte", "lte", "gt", "lt",
          "or", "in", "is", "ilike", "textSearch",
          "order", "limit", "range", "maybeSingle",
        ]
        for (const m of methods) {
          chain[m] = vi.fn().mockReturnValue(chain)
        }
        chain.single = vi.fn().mockResolvedValue({ data: fakeOrdenRow, error: null })
        chain.then = (resolve: any, reject?: any) =>
          Promise.resolve({ data: null, error: null }).then(resolve, reject)
        ordenesDeleteChain = chain
        return chain
      }
      if (table === "users") {
        return createChainMock(null) as any
      }
      // Default: plan limit check and other tables
      return createChainMock(null) as any
    })

    const res = await postOrdenes(createPostRequest(ordenBodyFromTurno))
    const { status } = await parseResponse(res)

    expect(status).toBe(409)
    // Verify delete was called on ordenes_servicio
    expect(ordenesDeleteChain.delete).toHaveBeenCalled()
    expect(ordenesDeleteChain.eq).toHaveBeenCalledWith("id", fakeOrdenRow.id)
  })

  it("T2-b: atomic claim returns DB error → 500 and orden is deleted", async () => {
    let turnosCallCount = 0
    let ordenesChain: any

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "turnos") {
        turnosCallCount++
        if (turnosCallCount === 1) {
          return createChainMock(fakeTurnoRow) as any
        }
        // turnosCallCount === 2: atomic claim returns DB error
        return createChainMock(null, { message: "conflict" }) as any
      }
      if (table === "ordenes_servicio") {
        const chain: any = {}
        const methods = [
          "select", "insert", "update", "upsert", "delete",
          "eq", "neq", "not", "gte", "lte", "gt", "lt",
          "or", "in", "is", "ilike", "textSearch",
          "order", "limit", "range", "maybeSingle",
        ]
        for (const m of methods) {
          chain[m] = vi.fn().mockReturnValue(chain)
        }
        chain.single = vi.fn().mockResolvedValue({ data: fakeOrdenRow, error: null })
        chain.then = (resolve: any, reject?: any) =>
          Promise.resolve({ data: null, error: null }).then(resolve, reject)
        ordenesChain = chain
        return chain
      }
      return createChainMock(null) as any
    })

    const res = await postOrdenes(createPostRequest(ordenBodyFromTurno))
    const { status } = await parseResponse(res)

    expect(status).toBe(500)
    expect(ordenesChain.delete).toHaveBeenCalled()
    expect(ordenesChain.eq).toHaveBeenCalledWith("id", fakeOrdenRow.id)
  })

  it("T2-c: atomic claim succeeds (1 row returned) → 201", async () => {
    let turnosCallCount = 0

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "turnos") {
        turnosCallCount++
        if (turnosCallCount === 1) {
          return createChainMock(fakeTurnoRow) as any
        }
        // turnosCallCount === 2: claim succeeds — returns 1 row
        return createChainMock([{ id: "turno-1" }], null) as any
      }
      if (table === "ordenes_servicio") {
        const chain: any = {}
        const methods = [
          "select", "insert", "update", "upsert", "delete",
          "eq", "neq", "not", "gte", "lte", "gt", "lt",
          "or", "in", "is", "ilike", "textSearch",
          "order", "limit", "range", "maybeSingle",
        ]
        for (const m of methods) {
          chain[m] = vi.fn().mockReturnValue(chain)
        }
        chain.single = vi.fn().mockResolvedValue({ data: fakeOrdenRow, error: null })
        chain.then = (resolve: any, reject?: any) =>
          Promise.resolve({ data: null, error: null }).then(resolve, reject)
        return chain
      }
      if (table === "cobros_orden") {
        return createChainMock(null) as any
      }
      return createChainMock(null) as any
    })

    const res = await postOrdenes(createPostRequest(ordenBodyFromTurno))
    expect(res.status).toBe(201)
  })
})

// ─── T3 — Monthly recurrence overflow ─────────────────────────────────────────

describe("T3 — POST /api/turnos: monthly recurrence date clamping", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthAdmin({ sucursalId: null })
    mockCookie(null)
  })

  it("T3: monthly recurrence from Jan 31 produces clamped dates (no overflow)", async () => {
    // 3 monthly occurrences starting Jan 31 2026
    // 2026-01-31 → 2026-02-28 (Feb has 28 days in 2026) → 2026-03-31
    const inicio = "2026-01-31T10:00:00.000Z"
    const fin = "2026-01-31T11:00:00.000Z"

    let capturedRows: any[] | null = null

    const turnosInsertChain: any = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      eq: vi.fn(),
      neq: vi.fn(),
      not: vi.fn(),
      gte: vi.fn(),
      lte: vi.fn(),
      gt: vi.fn(),
      lt: vi.fn(),
      or: vi.fn(),
      in: vi.fn(),
      is: vi.fn(),
      ilike: vi.fn(),
      textSearch: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      range: vi.fn(),
      maybeSingle: vi.fn(),
    }

    // All methods return `this` by default
    for (const m of Object.keys(turnosInsertChain)) {
      turnosInsertChain[m] = vi.fn().mockReturnValue(turnosInsertChain)
    }

    // Overlap check (SELECT): no conflicts
    const overlapChain = createChainMock([])
    // Insert chain: capture rows and return fake inserted data
    const insertResultChain: any = {}
    for (const m of [
      "select", "insert", "update", "upsert", "delete",
      "eq", "neq", "not", "gte", "lte", "gt", "lt",
      "or", "in", "is", "ilike", "textSearch",
      "order", "limit", "range", "maybeSingle",
    ]) {
      insertResultChain[m] = vi.fn().mockReturnValue(insertResultChain)
    }
    insertResultChain.then = (resolve: any, reject?: any) => {
      // Return minimal inserted rows with the captured rows' inicio dates
      const fakeInserted = capturedRows?.map((r: any, idx: number) => ({
        id: `turno-${idx}`,
        organization_id: "org-1",
        sucursal_id: "suc-A",
        cliente_id: "cliente-1",
        cliente_snapshot: null,
        tecnico_id: null,
        inicio: r.inicio,
        fin: r.fin,
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
        serie_id: "serie-1",
        recurrencia: idx === 0 ? { frecuencia: "mensual", intervalo: 1, total: 3 } : null,
        clientes: null,
        users: null,
        ordenes_servicio: null,
      })) ?? []
      return Promise.resolve({ data: fakeInserted, error: null }).then(resolve, reject)
    }

    // We need a custom turnos mock that:
    // 1. On the overlap SELECT → overlapChain (no tecnico assigned so overlap skipped actually)
    // 2. On INSERT → capture rows and return insertResultChain
    const turnosMock: any = {
      select: vi.fn().mockReturnValue(overlapChain),
      insert: vi.fn().mockImplementation((rows: any[]) => {
        capturedRows = rows
        return insertResultChain
      }),
      update: vi.fn().mockReturnValue(insertResultChain),
      upsert: vi.fn().mockReturnValue(insertResultChain),
      delete: vi.fn().mockReturnValue(insertResultChain),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      textSearch: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
    }

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "organizations") {
        return createChainMock({ modulo_agenda: true }) as any
      }
      if (table === "clientes") {
        return createChainMock({ id: "cliente-1" }) as any
      }
      if (table === "sucursales") {
        return createChainMock({ id: "suc-A" }) as any
      }
      if (table === "turnos") {
        return turnosMock as any
      }
      return createChainMock(null) as any
    })

    const body = {
      clienteId: "cliente-1",
      inicio,
      fin,
      tipo: "visita_diagnostico",
      recurrencia: { frecuencia: "mensual", intervalo: 1, total: 3 },
    }

    const res = await postTurnos(createPostRequest(body))
    expect(res.status).toBe(201)

    // Verify capturedRows has the correct clamped dates
    expect(capturedRows).not.toBeNull()
    expect(capturedRows!.length).toBe(3)

    // Row 0: 2026-01-31T10:00:00.000Z → day 31
    expect(capturedRows![0].inicio).toContain("2026-01-31")

    // Row 1: should be Feb 28 (2026 is not a leap year), NOT Mar 3
    expect(capturedRows![1].inicio).toContain("2026-02-28")
    expect(capturedRows![1].inicio).not.toContain("2026-03-03")

    // Row 2: should be Mar 31 (clamped back to 31 since March has 31 days)
    expect(capturedRows![2].inicio).toContain("2026-03-31")
  })
})

// ─── T5 — Turno state machine (PATCH /api/turnos/[id]) ───────────────────────

// Helper: create a ctx object matching Next.js dynamic route signature
function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) }
}

// Helper: create a PATCH request
function createPatchRequest(body: any, url = "http://localhost:3000/api/turnos/turno-1"): Request {
  return new Request(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

// Minimal turno row for PATCH fetch
function makeTurno(overrides: Record<string, any> = {}) {
  return {
    id: "turno-1",
    organization_id: "org-1",
    estado: "agendado",
    orden_id: null,
    tecnico_id: null,
    cliente_id: "cliente-1",
    inicio: new Date().toISOString(),
    fin: null,
    direccion: null,
    tipo: "visita_diagnostico",
    tipo_dispositivo: null,
    marca: null,
    modelo: null,
    problema_reportado: null,
    fotos_previas: [],
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
  }
}

describe("T5 — PATCH /api/turnos/[id]: state machine", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthAdmin()
    mockCookie(null)
  })

  it("T5-a: PATCH estado on a 'cancelado' turno → 400", async () => {
    const turno = makeTurno({ estado: "cancelado" })
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "turnos") return createChainMock(turno) as any
      return createChainMock(null) as any
    })

    const res = await patchTurno(
      createPatchRequest({ estado: "agendado" }),
      makeCtx("turno-1"),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/cancelado/i)
  })

  it("T5-b: PATCH estado on a 'no_show' turno → 400", async () => {
    const turno = makeTurno({ estado: "no_show" })
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "turnos") return createChainMock(turno) as any
      return createChainMock(null) as any
    })

    const res = await patchTurno(
      createPatchRequest({ estado: "confirmado" }),
      makeCtx("turno-1"),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/no_show/i)
  })

  it("T5-c: double-cancel → 400 and notifyTurno NOT called", async () => {
    const turno = makeTurno({ estado: "cancelado" })
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "turnos") return createChainMock(turno) as any
      return createChainMock(null) as any
    })

    const res = await patchTurno(
      createPatchRequest({ estado: "cancelado" }),
      makeCtx("turno-1"),
    )
    expect(res.status).toBe(400)
    expect(vi.mocked(notifyTurno)).not.toHaveBeenCalled()
  })

  it("T5-d: valid transition agendado→confirmado → 200", async () => {
    const turno = makeTurno({ estado: "agendado" })
    const updatedTurno = { ...turno, estado: "confirmado" }

    // fetchTurno uses maybeSingle() — must return the CURRENT state ("agendado")
    // PATCH update uses single() — returns the updated state ("confirmado")
    let turnosCallCount = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "turnos") {
        turnosCallCount++
        if (turnosCallCount === 1) {
          // fetchTurno call: maybeSingle returns current turno (agendado)
          return createChainMock(turno) as any
        }
        // Second call: the update + single returns updatedTurno
        return createChainMock(updatedTurno) as any
      }
      return createChainMock(null) as any
    })

    const res = await patchTurno(
      createPatchRequest({ estado: "confirmado" }),
      makeCtx("turno-1"),
    )
    expect(res.status).toBe(200)
  })

  it("T5-e: orden_generada turno cannot change estado via PATCH → 400", async () => {
    // turno has orden_id set (non-null) → current state would be 'orden_generada'
    // After fix: state machine blocks any estado change from orden_generada
    const turno = makeTurno({ estado: "orden_generada", orden_id: "orden-1" })
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "turnos") return createChainMock(turno) as any
      return createChainMock(null) as any
    })

    const res = await patchTurno(
      createPatchRequest({ estado: "realizado" }),
      makeCtx("turno-1"),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/orden generada/i)
  })
})
