import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { cookies } from "next/headers"
import {
  mockAuthSuccess, createChainMock, mockSupabaseFrom,
  createGetRequest, createPostRequest, parseResponse,
} from "./helpers"

vi.mock("@/lib/counters", () => ({
  getNextSaleNumber: vi.fn().mockResolvedValue({ numero: 1 }),
  getNextWarrantySaleNumber: vi.fn().mockResolvedValue("GAR-001"),
  getNextReturnNumber: vi.fn().mockResolvedValue("DEV-001"),
}))

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock("@/lib/webhooks/dispatcher", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from "@/app/api/ventas/route"
import { GET, DELETE } from "@/app/api/ventas/[id]/route"
import { POST as pagosPOST } from "@/app/api/ventas/[id]/pagos/route"
import { GET as devolucionGET } from "@/app/api/ventas/[id]/devolucion/route"

// ─── M2 tests: IVA snapshot error surfacing ───

describe("POST /api/ventas — IVA snapshot error → 500", () => {
  function mockAuthWithSucursal(opts: { role?: string; sucursalId?: string | null }) {
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "user-1",
        organizationId: "org-1",
        role: opts.role ?? "ADMIN",
        sucursalId: opts.sucursalId ?? null,
        email: "test@test.com",
      },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as any)
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("IVA snapshot UPDATE error → 500 when fiscal active", async () => {
    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })

    // rpc succeeds
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ventaId: "v1" }, error: null } as any)

    // org has ADITIVO regime (fiscal active)
    const orgChain = createChainMock({ iva_regimen: "ADITIVO", iva_tasa: 21, redondeo_efectivo: 0 })

    // ventas chain: update().eq() returns error (IVA snapshot fails)
    const ventasErrorChain: any = {}
    const ventasEqAfterUpdate: any = {}
    ventasEqAfterUpdate.then = (resolve: any) => Promise.resolve({ error: { message: "IVA DB fail" } }).then(resolve)
    ventasEqAfterUpdate.catch = (reject: any) => Promise.resolve({ error: { message: "IVA DB fail" } }).catch(reject)
    ventasErrorChain.update = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue(ventasEqAfterUpdate) })
    ventasErrorChain.select = vi.fn().mockReturnValue(ventasErrorChain)
    ventasErrorChain.eq = vi.fn().mockReturnValue(ventasErrorChain)
    ventasErrorChain.single = vi.fn().mockResolvedValue({ data: null, error: null })

    // sucursales chain for sucursalParaEscritura
    const sucursalesChain = createChainMock({ id: "suc-principal" })

    // depositos chain for getDepositoDeSucursal
    const depositosChain: any = {}
    for (const m of ["select", "eq", "is"]) depositosChain[m] = vi.fn().mockReturnValue(depositosChain)
    depositosChain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "organizations") return orgChain as any
      if (table === "ventas") return ventasErrorChain as any
      if (table === "sucursales") return sucursalesChain as any
      if (table === "depositos") return depositosChain as any
      return createChainMock(null, { message: `No mock for: ${table}` }) as any
    })

    const res = await POST(createPostRequest({
      clienteNombre: "Test Client",
      items: [{ inventarioId: "i1", descripcion: "Funda", cantidad: 1, precioUnitario: 100, diasGarantia: 0 }],
      metodoPago: "EFECTIVO",
    }))
    const { status } = await parseResponse(res)

    expect(status).toBe(500)
  })

  it("happy path — 201 when no IVA error (EXENTO)", async () => {
    mockAuthSuccess()

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ventaId: "v1" }, error: null } as any)

    const sucursalesChain = createChainMock({ id: "suc-principal" })
    const depositosChain: any = {}
    for (const m of ["select", "eq", "is"]) depositosChain[m] = vi.fn().mockReturnValue(depositosChain)
    depositosChain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })

    mockSupabaseFrom({
      organizations: createChainMock({ nombre: "Org", nombre_mostrar: "Org" }),
      ventas: createChainMock({ id: "v1", numero_venta: 1, total: 100 }),
      sucursales: sucursalesChain,
      depositos: depositosChain,
    })

    const res = await POST(createPostRequest({
      clienteNombre: "Test Client",
      items: [{ inventarioId: "i1", descripcion: "Funda", cantidad: 1, precioUnitario: 100, diasGarantia: 0 }],
      metodoPago: "EFECTIVO",
    }))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
  })
})

// ─── L1 tests: sucursal scoping in sub-routes ───

describe("GET /api/ventas/[id] — sucursal scope", () => {
  function mockAuthWithSucursal(opts: { role?: string; sucursalId?: string | null }) {
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "user-1",
        organizationId: "org-1",
        role: opts.role ?? "ADMIN",
        sucursalId: opts.sucursalId ?? null,
        email: "test@test.com",
      },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as any)
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("VENDEDOR sucursalId 'suc-A' → query gets .eq('sucursal_id', 'suc-A')", async () => {
    mockAuthWithSucursal({ role: "VENDEDOR", sucursalId: "suc-A" })

    // cookies mock: no cookie → getCookieSucursalId returns null
    // But for VENDEDOR, sucursalParaLectura uses userSucursalId regardless of cookie
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue(undefined),
    } as any)

    const chain = createChainMock({ id: "v1", numero_venta: 1 })
    mockSupabaseFrom({ ventas: chain })

    await GET(createGetRequest("http://localhost:3000/api/ventas/v1"), {
      params: Promise.resolve({ id: "v1" }),
    })

    const eqCalls = chain.eq.mock.calls
    const sucursalFilter = eqCalls.find((call: any[]) => call[0] === "sucursal_id")
    expect(sucursalFilter).toBeDefined()
    expect(sucursalFilter![1]).toBe("suc-A")
  })

  it("ADMIN with no cookie → verTodas → NO sucursal_id eq", async () => {
    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })

    // No cookie → getCookieSucursalId returns null → verTodas: true
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue(undefined),
    } as any)

    const chain = createChainMock({ id: "v1", numero_venta: 1 })
    mockSupabaseFrom({ ventas: chain })

    await GET(createGetRequest("http://localhost:3000/api/ventas/v1"), {
      params: Promise.resolve({ id: "v1" }),
    })

    const eqCalls = chain.eq.mock.calls
    const sucursalFilter = eqCalls.find((call: any[]) => call[0] === "sucursal_id")
    expect(sucursalFilter).toBeUndefined()
  })

  it("GET ventas/[id]/devolucion — VENDEDOR sucursalId 'suc-A' → ventas query gets sucursal_id eq", async () => {
    mockAuthWithSucursal({ role: "VENDEDOR", sucursalId: "suc-A" })

    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue(undefined),
    } as any)

    const ventasChain = createChainMock({ id: "v1" })
    const devolucionesChain = createChainMock([], null)

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return ventasChain as any
      if (table === "devoluciones_venta") return devolucionesChain as any
      return createChainMock(null, { message: `No mock for: ${table}` }) as any
    })

    await devolucionGET(createGetRequest("http://localhost:3000/api/ventas/v1/devolucion"), {
      params: Promise.resolve({ id: "v1" }),
    })

    const eqCalls = ventasChain.eq.mock.calls
    const sucursalFilter = eqCalls.find((call: any[]) => call[0] === "sucursal_id")
    expect(sucursalFilter).toBeDefined()
    expect(sucursalFilter![1]).toBe("suc-A")
  })

  it("GET ventas/[id]/pagos — ADMIN with cookie 'suc-A' → ventas query gets sucursal_id eq", async () => {
    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })

    // ADMIN with cookie = "suc-A" → filtro.sucursalId = "suc-A", verTodas: false
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn((name: string) =>
        name === "stapp-sucursal-activa" ? { value: "suc-A" } : undefined
      ),
    } as any)

    const ventasChain = createChainMock({ id: "v1", total: "100", monto_abonado: "0", estado: "COMPLETADA", cliente_id: null, organization_id: "org-1" })

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return ventasChain as any
      return createChainMock(null, { message: `No mock for: ${table}` }) as any
    })

    // POST to pagos — ADMIN only, passes the role check, then hits venta lookup
    await pagosPOST(
      new Request("http://localhost:3000/api/ventas/v1/pagos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monto: 50, metodoPago: "EFECTIVO" }),
      }),
      { params: Promise.resolve({ id: "v1" }) }
    )

    const eqCalls = ventasChain.eq.mock.calls
    const sucursalFilter = eqCalls.find((call: any[]) => call[0] === "sucursal_id")
    expect(sucursalFilter).toBeDefined()
    expect(sucursalFilter![1]).toBe("suc-A")
  })
})
