/**
 * Tests: Timezone-correctness for GET /api/turnos (desde/hasta → UTC bounds)
 * and GET /api/turnos/disponibilidad (org tz loaded + passed to dentroDeHorarioLaboral).
 *
 * Scenarios:
 *  TZ1 — GET ?desde=2026-06-10&hasta=2026-06-10 with org BsAs (UTC-3)
 *         → gte receives '2026-06-10T03:00:00.000Z', lte receives '2026-06-11T02:59:59.000Z'
 *  TZ2 — Same but org Mexico City (UTC-6)
 *         → gte '2026-06-10T06:00:00.000Z', lte '2026-06-11T05:59:59.000Z'
 *  TZ3 — No org zona_horaria row → falls back to DEFAULT_TIMEZONE (BsAs)
 *  TZ4 — disponibilidad: org zona_horaria loaded and passed; turno outside org-tz
 *         business hours is rejected as fueraDeHorario
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { cookies } from "next/headers"
import { mockSupabaseFrom, createChainMock, createGetRequest } from "./helpers"

import { GET } from "@/app/api/turnos/route"
import { GET as getDisponibilidad } from "@/app/api/turnos/disponibilidad/route"

// ─── Auth / cookie helpers ───────────────────────────────────────────────────

function mockAuthAdmin(organizationId = "org-1") {
  vi.mocked(auth).mockResolvedValue({
    user: {
      id: "user-admin-1",
      organizationId,
      role: "ADMIN",
      sucursalId: null,
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

// ─── TZ1 — Buenos Aires ───────────────────────────────────────────────────────

describe("GET /api/turnos — desde/hasta → UTC bounds (Buenos Aires UTC-3)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthAdmin()
    mockCookie("todas")
  })

  it("TZ1 — desde 2026-06-10 → gte 2026-06-10T03:00:00.000Z", async () => {
    const orgChain = createChainMock({ zona_horaria: "America/Argentina/Buenos_Aires" })
    const turnosChain = createChainMock([])
    turnosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({
      organizations: orgChain,
      turnos: turnosChain,
    })

    const url = "http://localhost:3000/api/turnos?desde=2026-06-10&hasta=2026-06-10"
    const res = await GET(createGetRequest(url))

    expect(res.status).toBe(200)

    const gteCalls = (vi.mocked(turnosChain.gte).mock.calls as any[][])
    const lteCalls = (vi.mocked(turnosChain.lte).mock.calls as any[][])

    const gteCall = gteCalls.find((c) => c[0] === "inicio")
    const lteCall = lteCalls.find((c) => c[0] === "inicio")

    expect(gteCall).toBeTruthy()
    expect(lteCall).toBeTruthy()

    // BsAs UTC-3: midnight local = 03:00 UTC
    expect(gteCall![1]).toBe("2026-06-10T03:00:00.000Z")
    // End of day BsAs 23:59:59 = 2026-06-11T02:59:59 UTC
    expect(lteCall![1]).toBe("2026-06-11T02:59:59.000Z")
  })
})

// ─── TZ2 — Mexico City ───────────────────────────────────────────────────────

describe("GET /api/turnos — desde/hasta → UTC bounds (Mexico City UTC-6)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthAdmin()
    mockCookie("todas")
  })

  it("TZ2 — desde 2026-06-10, org Mexico City → gte 2026-06-10T06:00:00.000Z", async () => {
    const orgChain = createChainMock({ zona_horaria: "America/Mexico_City" })
    const turnosChain = createChainMock([])
    turnosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({
      organizations: orgChain,
      turnos: turnosChain,
    })

    const url = "http://localhost:3000/api/turnos?desde=2026-06-10&hasta=2026-06-10"
    const res = await GET(createGetRequest(url))

    expect(res.status).toBe(200)

    const gteCalls = (vi.mocked(turnosChain.gte).mock.calls as any[][])
    const lteCalls = (vi.mocked(turnosChain.lte).mock.calls as any[][])

    const gteCall = gteCalls.find((c) => c[0] === "inicio")
    const lteCall = lteCalls.find((c) => c[0] === "inicio")

    // Mexico City UTC-6: midnight local = 06:00 UTC
    expect(gteCall![1]).toBe("2026-06-10T06:00:00.000Z")
    // 23:59:59 local = 2026-06-11T05:59:59 UTC
    expect(lteCall![1]).toBe("2026-06-11T05:59:59.000Z")
  })
})

// ─── TZ3 — no zona_horaria → fallback to DEFAULT_TIMEZONE (BsAs) ─────────────

describe("GET /api/turnos — fallback to DEFAULT_TIMEZONE when org has no zona_horaria", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthAdmin()
    mockCookie("todas")
  })

  it("TZ3 — org returns null zona_horaria → falls back to BsAs UTC-3", async () => {
    const orgChain = createChainMock({ zona_horaria: null })
    const turnosChain = createChainMock([])
    turnosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({
      organizations: orgChain,
      turnos: turnosChain,
    })

    const url = "http://localhost:3000/api/turnos?desde=2026-06-10&hasta=2026-06-10"
    const res = await GET(createGetRequest(url))

    expect(res.status).toBe(200)

    const gteCalls = (vi.mocked(turnosChain.gte).mock.calls as any[][])
    const gteCall = gteCalls.find((c) => c[0] === "inicio")

    // DEFAULT_TIMEZONE = BsAs = UTC-3 → 03:00 UTC offset
    expect(gteCall![1]).toBe("2026-06-10T03:00:00.000Z")
  })
})

// ─── TZ4 — disponibilidad uses org tz ────────────────────────────────────────

describe("GET /api/turnos/disponibilidad — org zona_horaria loaded and respected", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthAdmin()
    mockCookie(null)
  })

  it("TZ4 — turno at 09:00 UTC = 06:00 BsAs (outside 08:00-18:00 horario) → fueraDeHorario", async () => {
    // 09:00 UTC = 06:00 America/Argentina/Buenos_Aires
    // Horario laboral: lun 08:00-18:00
    // Expected: fueraDeHorario=true
    const inicio = new Date("2026-06-15T09:00:00Z") // Monday 2026-06-15 = UTC; 06:00 BsAs

    const horarioLaboral = {
      lun: [{ de: "08:00", a: "18:00" }],
    }

    const usersChain = createChainMock({ horario_laboral: horarioLaboral })
    const orgChain = createChainMock({ zona_horaria: "America/Argentina/Buenos_Aires" })
    const turnosChain = createChainMock([])
    turnosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({
      users: usersChain,
      organizations: orgChain,
      turnos: turnosChain,
    })

    const url = `http://localhost:3000/api/turnos/disponibilidad?tecnicoId=tec-1&inicio=${inicio.toISOString()}`
    const res = await getDisponibilidad(createGetRequest(url))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.fueraDeHorario).toBe(true)
    expect(body.disponible).toBe(false)
  })

  it("TZ4b — turno at 14:00 UTC = 11:00 BsAs (inside 08:00-18:00 horario) → NOT fueraDeHorario", async () => {
    // 14:00 UTC = 11:00 America/Argentina/Buenos_Aires
    const inicio = new Date("2026-06-15T14:00:00Z") // Monday

    const horarioLaboral = {
      lun: [{ de: "08:00", a: "18:00" }],
    }

    const usersChain = createChainMock({ horario_laboral: horarioLaboral })
    const orgChain = createChainMock({ zona_horaria: "America/Argentina/Buenos_Aires" })
    const turnosChain = createChainMock([])
    turnosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({
      users: usersChain,
      organizations: orgChain,
      turnos: turnosChain,
    })

    const url = `http://localhost:3000/api/turnos/disponibilidad?tecnicoId=tec-1&inicio=${inicio.toISOString()}`
    const res = await getDisponibilidad(createGetRequest(url))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.fueraDeHorario).toBe(false)
    expect(body.disponible).toBe(true)
  })
})
