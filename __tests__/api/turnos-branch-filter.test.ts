/**
 * Tests: PR2 — Branch scoping for POST and GET /api/turnos
 *         and disponibilidad invariant.
 *
 * Spec scenarios covered:
 *  T2.5a — Branch user creates a turno: persisted row has sucursal_id = active branch
 *  T2.5b — ADMIN creates turno with branch cookie: correct stamp
 *  T2.5c — Branch-scoped user lists turnos: only branch turnos returned
 *  T2.5d — ADMIN verTodas lists all turnos: no sucursal_id filter
 *  T2.6  — GET with TECNICO filter + branch filter composes additively
 *  T2.7  — Disponibilidad ignores branch cookie
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { cookies } from "next/headers"
import { mockSupabaseFrom, createChainMock, createGetRequest, createPostRequest } from "./helpers"

import { GET, POST } from "@/app/api/turnos/route"
import { GET as getDisponibilidad } from "@/app/api/turnos/disponibilidad/route"

// ─── Cookie mock ─────────────────────────────────────────────────────────────

function mockCookie(value: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) =>
      name === "stapp-sucursal-activa" && value ? { value } : undefined
    ),
    set: vi.fn(),
  } as any)
}

// ─── Auth mock that carries sucursalId on session.user ───────────────────────

function mockAuthWithSucursal(opts: {
  role?: string
  userId?: string
  organizationId?: string
  sucursalId?: string | null
}) {
  vi.mocked(auth).mockResolvedValue({
    user: {
      id: opts.userId ?? "user-1",
      organizationId: opts.organizationId ?? "org-1",
      role: opts.role ?? "ADMIN",
      sucursalId: opts.sucursalId ?? null,
      email: "test@test.com",
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

// ─── Minimal valid turno POST body ───────────────────────────────────────────

const turnoBody = {
  clienteId: "cliente-1",
  inicio: new Date(Date.now() + 3600 * 1000).toISOString(),
  tipo: "visita_diagnostico",
}

// ─── POST — stamp sucursal_id ─────────────────────────────────────────────────

describe("POST /api/turnos — sucursal_id stamp", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("T2.5a — branch user creates turno: row stamped with active branch", async () => {
    mockAuthWithSucursal({ role: "TECNICO", userId: "tec-1", sucursalId: "suc-A" })
    mockCookie("suc-A") // cookie irrelevant for TECNICO but set for completeness

    const fakeInserted = [{
      id: "turno-1",
      organization_id: "org-1",
      sucursal_id: "suc-A",
      cliente_id: "cliente-1",
      cliente_snapshot: null,
      tecnico_id: "tec-1",
      inicio: turnoBody.inicio,
      fin: null,
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
      created_by: "tec-1",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      serie_id: null,
      recurrencia: null,
      clientes: null,
      users: null,
      ordenes_servicio: null,
    }]

    const turnosChain = createChainMock(fakeInserted)
    // Route does: supabaseAdmin.from("turnos").insert(rows).select(...)
    // The chain: insert() → returns chain, select() → returns chain, await chain → .then resolves
    // createChainMock already sets .then to resolve with { data: fakeInserted, error: null }

    mockSupabaseFrom({
      organizations: createChainMock({ modulo_agenda: true }),
      clientes: createChainMock({ id: "cliente-1" }),
      sucursales: createChainMock({ id: "suc-A" }), // getPrincipalId lookup
      turnos: turnosChain,
    })

    const res = await POST(createPostRequest(turnoBody))

    expect(res.status).toBe(201)
    // Verify the insert included sucursal_id: "suc-A"
    const insertCall = vi.mocked(turnosChain.insert).mock.calls[0]?.[0]
    const insertedRows = Array.isArray(insertCall) ? insertCall : [insertCall]
    expect(insertedRows[0]).toMatchObject({ sucursal_id: "suc-A" })
  })

  it("T2.5b — ADMIN with branch cookie stamps that branch on turno", async () => {
    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie("suc-B")

    const fakeInserted = [{
      id: "turno-2",
      organization_id: "org-1",
      sucursal_id: "suc-B",
      cliente_id: "cliente-1",
      cliente_snapshot: null,
      tecnico_id: null,
      inicio: turnoBody.inicio,
      fin: null,
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
      created_by: "user-1",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      serie_id: null,
      recurrencia: null,
      clientes: null,
      users: null,
      ordenes_servicio: null,
    }]

    const turnosChain = createChainMock(fakeInserted)

    mockSupabaseFrom({
      organizations: createChainMock({ modulo_agenda: true }),
      clientes: createChainMock({ id: "cliente-1" }),
      sucursales: createChainMock({ id: "suc-B" }),
      turnos: turnosChain,
    })

    const res = await POST(createPostRequest(turnoBody))

    expect(res.status).toBe(201)
    const insertCall = vi.mocked(turnosChain.insert).mock.calls[0]?.[0]
    const insertedRows = Array.isArray(insertCall) ? insertCall : [insertCall]
    expect(insertedRows[0]).toMatchObject({ sucursal_id: "suc-B" })
  })

  it("returns 500 when org has no principal sucursal", async () => {
    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie(null)

    mockSupabaseFrom({
      organizations: createChainMock({ modulo_agenda: true }),
      clientes: createChainMock({ id: "cliente-1" }),
      // sucursalParaEscritura -> getPrincipalId returns null
      sucursales: createChainMock(null),
    })

    const res = await POST(createPostRequest(turnoBody))
    expect(res.status).toBe(500)
  })
})

// ─── GET — branch filter ──────────────────────────────────────────────────────

describe("GET /api/turnos — branch filter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("T2.5c — branch-scoped user: query filtered by sucursal_id", async () => {
    mockAuthWithSucursal({ role: "VENDEDOR", sucursalId: "suc-A" })
    mockCookie("suc-A")

    const turnosChain = createChainMock([])
    turnosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ turnos: turnosChain })

    const res = await GET(createGetRequest("http://localhost:3000/api/turnos"))

    expect(res.status).toBe(200)
    expect(turnosChain.eq).toHaveBeenCalledWith("sucursal_id", "suc-A")
  })

  it("T2.5d — ADMIN verTodas: no sucursal_id filter applied", async () => {
    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie("todas")

    const turnosChain = createChainMock([])
    turnosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ turnos: turnosChain })

    const res = await GET(createGetRequest("http://localhost:3000/api/turnos"))

    expect(res.status).toBe(200)
    const eqCalls = vi.mocked(turnosChain.eq).mock.calls as any[][]
    expect(eqCalls.find((c) => c[0] === "sucursal_id")).toBeUndefined()
  })

  it("T2.5d (no cookie) — ADMIN without cookie: no sucursal_id filter", async () => {
    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie(null)

    const turnosChain = createChainMock([])
    turnosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ turnos: turnosChain })

    const res = await GET(createGetRequest("http://localhost:3000/api/turnos"))

    expect(res.status).toBe(200)
    const eqCalls = vi.mocked(turnosChain.eq).mock.calls as any[][]
    expect(eqCalls.find((c) => c[0] === "sucursal_id")).toBeUndefined()
  })
})

// ─── GET — branch + TECNICO filter composition (T2.6) ────────────────────────

describe("GET /api/turnos — branch filter composes with TECNICO role filter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("T2.6 — TECNICO role + branch cookie: both tecnico_id and sucursal_id filters applied", async () => {
    mockAuthWithSucursal({ role: "TECNICO", userId: "tec-42", sucursalId: "suc-A" })
    mockCookie("suc-A") // TECNICO ignores cookie for read (uses userSucursalId), but both result in suc-A

    const turnosChain = createChainMock([])
    turnosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ turnos: turnosChain })

    const res = await GET(createGetRequest("http://localhost:3000/api/turnos"))

    expect(res.status).toBe(200)
    const eqCalls = vi.mocked(turnosChain.eq).mock.calls as any[][]
    // TECNICO filter
    expect(eqCalls.find((c) => c[0] === "tecnico_id" && c[1] === "tec-42")).toBeTruthy()
    // Branch filter — additive
    expect(eqCalls.find((c) => c[0] === "sucursal_id" && c[1] === "suc-A")).toBeTruthy()
  })
})

// ─── Disponibilidad — branch invariant (T2.7) ────────────────────────────────

describe("GET /api/turnos/disponibilidad — ignores branch cookie", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("T2.7 — returns org-wide availability regardless of branch cookie", async () => {
    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie("suc-A") // cookie is set but must be ignored

    const usersChain = createChainMock({ horario_laboral: null })
    const turnosChain = createChainMock([])
    turnosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({
      users: usersChain,
      turnos: turnosChain,
    })

    const url = "http://localhost:3000/api/turnos/disponibilidad?tecnicoId=tec-1&inicio=" + new Date().toISOString()
    const res = await getDisponibilidad(createGetRequest(url))

    expect(res.status).toBe(200)
    // No sucursal_id eq filter must be on the turnos query
    const eqCalls = vi.mocked(turnosChain.eq).mock.calls as any[][]
    expect(eqCalls.find((c) => c[0] === "sucursal_id")).toBeUndefined()
  })
})
