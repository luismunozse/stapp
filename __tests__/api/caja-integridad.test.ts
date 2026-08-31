/**
 * Tests: integrity fixes for caja routes
 *
 * F1 — POST /api/caja/sesiones: open-session check must be scoped per sucursal
 * F2 — fetchMovimientosDia: cobros_orden must filter anulado=false
 * F3 — POST /api/caja/sesiones/[id]/cerrar: UPDATE must be optimistic-locked on estado='ABIERTA'
 * F4 — GET /api/caja/sesiones/[id]: must scope sesion fetch to user's sucursal and pass sesion.sucursal_id to fetchMovimientosDia
 * F5 — DELETE /api/caja/movimientos/[id]: must guard against closed-session delete and sucursal scope
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  createGetRequest,
  parseResponse,
} from "./helpers"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { cookies } from "next/headers"
import * as cajaUtils from "@/lib/caja-utils"

// ─── Partial mock: spy on fetchMovimientosDia for F2 / F4 ────────────────────
vi.mock("@/lib/caja-utils", async (orig) => ({
  ...(await orig<typeof cajaUtils>()),
  fetchMovimientosDia: vi.fn().mockResolvedValue([]),
  computeTotales: vi.fn().mockReturnValue({
    totalIngresos: 0,
    totalEgresos: 0,
    totalIngresosEfectivo: 0,
    totalEgresosEfectivo: 0,
    totalCostosFinancieros: 0,
    totalDia: 0,
    porMetodo: {},
    porTipo: {},
    ingresoReal: 0,
  }),
}))

// ─── Cookie helper ────────────────────────────────────────────────────────────
function mockCookie(value: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) =>
      name === "stapp-sucursal-activa" && value ? { value } : undefined
    ),
    set: vi.fn(),
  } as any)
}

// ─── Auth helper with sucursalId ──────────────────────────────────────────────
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

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

// =============================================================================
// F1 — POST /api/caja/sesiones: open-check must be scoped per sucursal
// =============================================================================

describe("F1 — POST /api/caja/sesiones: open-session check scoped per sucursal", () => {
  beforeEach(() => vi.clearAllMocks())

  it("open-check chain receives .eq('sucursal_id', sucursalId)", async () => {
    // Import here so vi.mock above applies
    const { POST } = await import("@/app/api/caja/sesiones/route")

    mockAuthWithSucursal({ role: "ADMIN", organizationId: "org-1", userId: "u-1" })
    mockCookie("suc-A")

    const sesionesChain = createChainMock(null, null) // no session found
    mockSupabaseFrom({
      sucursales: createChainMock({ id: "suc-A" }, null), // getPrincipalId (cookie wins for admin)
      sesiones_caja: sesionesChain,
    })

    const response = await POST(
      createPostRequest({ saldoInicial: 1000 }, "http://localhost:3000/api/caja/sesiones")
    )

    // The open-check eq calls should include sucursal_id
    const eqCalls = vi.mocked(sesionesChain.eq).mock.calls as any[][]
    expect(eqCalls.find((c) => c[0] === "sucursal_id" && c[1] === "suc-A")).toBeTruthy()
  })

  it("returns 400 when a session is already open for that sucursal", async () => {
    const { POST } = await import("@/app/api/caja/sesiones/route")

    mockAuthWithSucursal({ role: "ADMIN", organizationId: "org-1", userId: "u-1" })
    mockCookie("suc-A")

    // existing open session for this sucursal
    const sesionesChain = createChainMock({ id: "ses-existing" }, null)
    mockSupabaseFrom({
      sucursales: createChainMock({ id: "suc-A" }, null),
      sesiones_caja: sesionesChain,
    })

    const response = await POST(
      createPostRequest({ saldoInicial: 1000 }, "http://localhost:3000/api/caja/sesiones")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(400)
  })
})

// =============================================================================
// F2 — fetchMovimientosDia: cobros_orden must filter anulado=false
// =============================================================================

describe("F2 — fetchMovimientosDia: cobros_orden filters anulado=false", () => {
  beforeEach(() => vi.clearAllMocks())

  it("cobros_orden query chain receives .eq('anulado', false)", async () => {
    // We test the real fetchMovimientosDia (not the spy), so we import separately
    const { fetchMovimientosDia: realFetch } = await vi.importActual<typeof cajaUtils>(
      "@/lib/caja-utils"
    )

    const cobrosChain = createChainMock([], null)
    mockSupabaseFrom({
      cobros_orden: cobrosChain,
      pagos_parciales: createChainMock([], null),
      pagos_venta: createChainMock([], null),
      cuenta_corriente: createChainMock([], null),
      movimientos_caja: createChainMock([], null),
    })

    await realFetch("org-1", "2024-01-01T00:00:00Z", "2024-01-01T23:59:59Z")

    const eqCalls = vi.mocked(cobrosChain.eq).mock.calls as any[][]
    expect(eqCalls.find((c) => c[0] === "anulado" && c[1] === false)).toBeTruthy()
  })
})

// =============================================================================
// F3 — POST /api/caja/sesiones/[id]/cerrar: UPDATE must be optimistic-locked
// =============================================================================

describe("F3 — POST /api/caja/sesiones/[id]/cerrar: optimistic-lock on estado=ABIERTA", () => {
  beforeEach(() => vi.clearAllMocks())

  const mockSesion = {
    id: "ses-1",
    organization_id: "org-1",
    estado: "ABIERTA",
    saldo_inicial: "1000",
    opened_at: "2024-01-01T09:00:00Z",
    sucursal_id: "suc-B",
  }

  it("UPDATE chain includes .eq('estado', 'ABIERTA')", async () => {
    const { POST } = await import("@/app/api/caja/sesiones/[id]/cerrar/route")

    mockAuthSuccess()

    const updateChain = createChainMock([{ ...mockSesion, estado: "CERRADA" }], null)
    updateChain.select = vi.fn().mockReturnValue(updateChain)

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "sesiones_caja") {
        const chain = createChainMock(null)
        let callCount = 0
        chain.single = vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) return Promise.resolve({ data: mockSesion, error: null })
          return Promise.resolve({ data: { ...mockSesion, estado: "CERRADA" }, error: null })
        })
        chain.update = vi.fn().mockReturnValue(updateChain)
        return chain as any
      }
      return createChainMock(null) as any
    })

    await POST(
      createPostRequest({ conteoFisico: 5000 }),
      createParams("ses-1")
    )

    const eqCalls = vi.mocked(updateChain.eq).mock.calls as any[][]
    expect(eqCalls.find((c) => c[0] === "estado" && c[1] === "ABIERTA")).toBeTruthy()
  })

  it("returns 400 when UPDATE returns empty (race: session already closed)", async () => {
    const { POST } = await import("@/app/api/caja/sesiones/[id]/cerrar/route")

    mockAuthSuccess()

    // UPDATE returns empty array = no row matched the ABIERTA predicate
    const updateChain = createChainMock([], null)
    updateChain.select = vi.fn().mockReturnValue(updateChain)

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "sesiones_caja") {
        const chain = createChainMock(null)
        let callCount = 0
        chain.single = vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) return Promise.resolve({ data: mockSesion, error: null })
          // second call would not happen with the new code
          return Promise.resolve({ data: null, error: null })
        })
        chain.update = vi.fn().mockReturnValue(updateChain)
        return chain as any
      }
      return createChainMock(null) as any
    })

    const response = await POST(
      createPostRequest({ conteoFisico: 5000 }),
      createParams("ses-1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toMatch(/cerrada|abierta/i)
  })
})

// =============================================================================
// F4 — GET /api/caja/sesiones/[id]: sucursal scope + fetchMovimientosDia arg
// =============================================================================

describe("F4 — GET /api/caja/sesiones/[id]: sucursal scope + movements wiring", () => {
  beforeEach(() => vi.clearAllMocks())

  const mockSesion = {
    id: "ses-1",
    organization_id: "org-1",
    estado: "CERRADA",
    saldo_inicial: "1000",
    opened_at: "2024-01-01T09:00:00Z",
    closed_at: "2024-01-01T18:00:00Z",
    sucursal_id: "suc-A",
    total_ingresos: null,
    total_egresos: null,
    total_ingresos_efectivo: null,
    total_egresos_efectivo: null,
    conteo_fisico: null,
    diferencia: null,
    observaciones_cierre: null,
    usuario_apertura: null,
    usuario_cierre: null,
  }

  // El detalle de un cierre pasó a ser admin-only: es histórico financiero,
  // del mismo lado del corte que el export CSV. El filtro por sucursal sigue
  // vivo igual — ahora lo gobierna el selector de sucursal del ADMIN.
  it("ADMIN con el selector en una sucursal: sesion fetch gets .eq('sucursal_id', ...)", async () => {
    const { GET } = await import("@/app/api/caja/sesiones/[id]/route")

    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie("suc-A")

    const sesionesChain = createChainMock(mockSesion, null)
    mockSupabaseFrom({
      sesiones_caja: sesionesChain,
    })

    const response = await GET(
      createGetRequest("http://localhost:3000/api/caja/sesiones/ses-1"),
      createParams("ses-1")
    )

    const eqCalls = vi.mocked(sesionesChain.eq).mock.calls as any[][]
    expect(eqCalls.find((c) => c[0] === "sucursal_id" && c[1] === "suc-A")).toBeTruthy()
  })

  it("admin verTodas: sesion fetch does NOT get .eq('sucursal_id', ...) beyond org filter", async () => {
    const { GET } = await import("@/app/api/caja/sesiones/[id]/route")

    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie("todas")

    const sesionesChain = createChainMock(mockSesion, null)
    mockSupabaseFrom({
      sesiones_caja: sesionesChain,
    })

    await GET(
      createGetRequest("http://localhost:3000/api/caja/sesiones/ses-1"),
      createParams("ses-1")
    )

    const eqCalls = vi.mocked(sesionesChain.eq).mock.calls as any[][]
    // sucursal_id filter must NOT be applied for admin verTodas
    expect(eqCalls.find((c) => c[0] === "sucursal_id")).toBeUndefined()
  })

  it("fetchMovimientosDia is called with sesion.sucursal_id as 5th arg", async () => {
    const { GET } = await import("@/app/api/caja/sesiones/[id]/route")

    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie("todas")

    mockSupabaseFrom({
      sesiones_caja: createChainMock(mockSesion, null),
    })

    const response = await GET(
      createGetRequest("http://localhost:3000/api/caja/sesiones/ses-1"),
      createParams("ses-1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    const fetchCall = vi.mocked(cajaUtils.fetchMovimientosDia).mock.calls[0]
    expect(fetchCall[4]).toBe("suc-A") // sesion.sucursal_id
  })

  it("ADMIN con el selector en otra sucursal → 404", async () => {
    const { GET } = await import("@/app/api/caja/sesiones/[id]/route")

    // El selector está en suc-B, pero la sesión es de suc-A
    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie("suc-B")

    // When sucursal filter is applied, no session is found
    mockSupabaseFrom({
      sesiones_caja: createChainMock(null, null), // null = not found
    })

    const response = await GET(
      createGetRequest("http://localhost:3000/api/caja/sesiones/ses-1"),
      createParams("ses-1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(404)
  })

  it("un rol atado a sucursal ya no llega al detalle: 403, no 404", async () => {
    // Antes era requireAuth: cualquier rol autenticado leía el detalle de
    // cualquier cierre de su organización, y el único freno era el filtro por
    // sucursal. Ahora ni entra.
    const { GET } = await import("@/app/api/caja/sesiones/[id]/route")

    mockAuthWithSucursal({ role: "VENDEDOR", sucursalId: "suc-A" })
    mockCookie(null)
    mockSupabaseFrom({ sesiones_caja: createChainMock(mockSesion, null) })

    const response = await GET(
      createGetRequest("http://localhost:3000/api/caja/sesiones/ses-1"),
      createParams("ses-1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(403)
  })
})

// =============================================================================
// F5 — DELETE /api/caja/movimientos/[id]: closed-session guard + sucursal scope
// =============================================================================

describe("F5 — DELETE /api/caja/movimientos/[id]: guards and sucursal scope", () => {
  beforeEach(() => vi.clearAllMocks())

  function createDeleteRequest(url: string) {
    return new Request(url, { method: "DELETE" })
  }

  it("returns 400 when deleting a movimiento from a CERRADA session", async () => {
    const { DELETE } = await import("@/app/api/caja/movimientos/[id]/route")

    mockAuthSuccess({ role: "ADMIN" })
    mockCookie(null)

    const movimiento = {
      id: "mov-1",
      organization_id: "org-1",
      sesion_caja_id: "ses-1",
      sucursal_id: "suc-A",
      sesiones_caja: { id: "ses-1", estado: "CERRADA" },
    }

    mockSupabaseFrom({
      movimientos_caja: createChainMock(movimiento, null),
    })

    const response = await DELETE(
      createDeleteRequest("http://localhost:3000/api/caja/movimientos/mov-1"),
      createParams("mov-1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toMatch(/cerrada/i)
  })

  it("returns 404 when ADMIN scoped to suc-B tries to delete movimiento from suc-A", async () => {
    const { DELETE } = await import("@/app/api/caja/movimientos/[id]/route")

    // ADMIN with cookie suc-B → sucursalParaLectura returns { sucursalId: 'suc-B', verTodas: false }
    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie("suc-B")

    const movimiento = {
      id: "mov-1",
      organization_id: "org-1",
      sesion_caja_id: "ses-1",
      sucursal_id: "suc-A", // different branch than cookie
      sesiones_caja: { id: "ses-1", estado: "ABIERTA" },
    }

    mockSupabaseFrom({
      movimientos_caja: createChainMock(movimiento, null),
    })

    const response = await DELETE(
      createDeleteRequest("http://localhost:3000/api/caja/movimientos/mov-1"),
      createParams("mov-1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(404)
  })

  it("succeeds when session is ABIERTA and sucursal matches", async () => {
    const { DELETE } = await import("@/app/api/caja/movimientos/[id]/route")

    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie("suc-A")

    const movimiento = {
      id: "mov-1",
      organization_id: "org-1",
      sesion_caja_id: "ses-1",
      sucursal_id: "suc-A",
      sesiones_caja: { id: "ses-1", estado: "ABIERTA" },
    }

    const deleteChain = createChainMock(null, null)
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "movimientos_caja") {
        return createChainMock(movimiento, null) as any
      }
      return deleteChain as any
    })

    const response = await DELETE(
      createDeleteRequest("http://localhost:3000/api/caja/movimientos/mov-1"),
      createParams("mov-1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
  })

  it("returns 404 when movimiento not found", async () => {
    const { DELETE } = await import("@/app/api/caja/movimientos/[id]/route")

    mockAuthSuccess({ role: "ADMIN" })
    mockCookie(null)

    mockSupabaseFrom({
      movimientos_caja: createChainMock(null, null), // not found
    })

    const response = await DELETE(
      createDeleteRequest("http://localhost:3000/api/caja/movimientos/mov-999"),
      createParams("mov-999")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(404)
  })
})
