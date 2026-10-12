/**
 * Tests: read-side cross-branch data leak fixes
 *
 * Covers three confirmed leaks:
 *   LEAK 1 — GET /api/clientes/[id]/ordenes-pendientes
 *   LEAK 2 — GET /api/facturacion  and  GET /api/facturacion/[id]
 *   LEAK 3 — GET /api/search  (RPC path + ILIKE fallback path)
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { cookies } from "next/headers"
import { mockSupabaseFrom, createChainMock, createGetRequest } from "./helpers"

import { GET as getOrdenesPendientes } from "@/app/api/clientes/[id]/ordenes-pendientes/route"
import { GET as getFacturacion } from "@/app/api/facturacion/route"
import { GET as getFacturacionById } from "@/app/api/facturacion/[id]/route"
import { GET as getSearch } from "@/app/api/search/route"

// ─── Cookie mock ─────────────────────────────────────────────────────────────

function mockCookie(value: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) =>
      name === "stapp-sucursal-activa" && value ? { value } : undefined
    ),
    set: vi.fn(),
  } as any)
}

// ─── Auth mock with sucursalId on session.user ────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// LEAK 1 — GET /api/clientes/[id]/ordenes-pendientes
// ─────────────────────────────────────────────────────────────────────────────

describe("LEAK 1 — GET /api/clientes/[id]/ordenes-pendientes — branch filter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("TECNICO sucursalId 'suc-A' → ordenes_servicio query gets .eq('sucursal_id', 'suc-A')", async () => {
    mockAuthWithSucursal({ role: "TECNICO", sucursalId: "suc-A" })
    mockCookie(null)

    const ordenesChain = createChainMock([])
    mockSupabaseFrom({
      ordenes_servicio: ordenesChain,
      cuenta_corriente: createChainMock([]),
    })

    const req = createGetRequest("http://localhost:3000/api/clientes/cliente-1/ordenes-pendientes")
    const res = await getOrdenesPendientes(req, {
      params: Promise.resolve({ id: "cliente-1" }),
    })

    expect(res.status).toBe(200)
    const eqCalls = vi.mocked(ordenesChain.eq).mock.calls as any[][]
    expect(eqCalls.find((c) => c[0] === "sucursal_id" && c[1] === "suc-A")).toBeTruthy()
  })

  it("ADMIN verTodas (no cookie) → no sucursal_id eq applied", async () => {
    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie(null)

    const ordenesChain = createChainMock([])
    mockSupabaseFrom({
      ordenes_servicio: ordenesChain,
      cuenta_corriente: createChainMock([]),
    })

    const req = createGetRequest("http://localhost:3000/api/clientes/cliente-1/ordenes-pendientes")
    const res = await getOrdenesPendientes(req, {
      params: Promise.resolve({ id: "cliente-1" }),
    })

    expect(res.status).toBe(200)
    const eqCalls = vi.mocked(ordenesChain.eq).mock.calls as any[][]
    expect(eqCalls.find((c) => c[0] === "sucursal_id")).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// LEAK 2 — GET /api/facturacion — branch filter
// ─────────────────────────────────────────────────────────────────────────────

describe("LEAK 2 — GET /api/facturacion — branch filter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("ADMIN cookie 'suc-B' → facturas query gets .eq('ordenes_servicio.sucursal_id', 'suc-B')", async () => {
    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie("suc-B")

    const facturasChain = createChainMock([])
    mockSupabaseFrom({ facturas: facturasChain })

    const res = await getFacturacion(createGetRequest("http://localhost:3000/api/facturacion"))

    expect(res.status).toBe(200)
    const eqCalls = vi.mocked(facturasChain.eq).mock.calls as any[][]
    expect(
      eqCalls.find((c) => c[0] === "ordenes_servicio.sucursal_id" && c[1] === "suc-B")
    ).toBeTruthy()
  })

  it("ADMIN verTodas (cookie 'todas') → no ordenes_servicio.sucursal_id eq applied", async () => {
    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie("todas")

    const facturasChain = createChainMock([])
    mockSupabaseFrom({ facturas: facturasChain })

    const res = await getFacturacion(createGetRequest("http://localhost:3000/api/facturacion"))

    expect(res.status).toBe(200)
    const eqCalls = vi.mocked(facturasChain.eq).mock.calls as any[][]
    expect(eqCalls.find((c) => c[0] === "ordenes_servicio.sucursal_id")).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// LEAK 2b — GET /api/facturacion/[id] — branch filter
// ─────────────────────────────────────────────────────────────────────────────

describe("LEAK 2b — GET /api/facturacion/[id] — branch filter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("ADMIN cookie 'suc-B' → single-factura query gets .eq('ordenes_servicio.sucursal_id', 'suc-B')", async () => {
    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie("suc-B")

    const facturaData = {
      id: "f-1",
      orden_id: "o-1",
      numero_factura: 1,
      fecha: "2024-01-01",
      subtotal: 1000,
      iva: 0,
      total: 1000,
      monto_abonado: 0,
      estado_pago: "PENDIENTE",
      created_at: "2024-01-01",
      ordenes_servicio: {
        id: "o-1",
        numero_orden: 1,
        dispositivo: "iPhone",
        organization_id: "org-1",
        clientes: { nombre: "Test" },
      },
      pagos_parciales: [],
    }
    const facturasChain = createChainMock(facturaData)
    mockSupabaseFrom({ facturas: facturasChain })

    const res = await getFacturacionById(
      createGetRequest("http://localhost:3000/api/facturacion/f-1"),
      { params: Promise.resolve({ id: "f-1" }) }
    )

    expect(res.status).toBe(200)
    const eqCalls = vi.mocked(facturasChain.eq).mock.calls as any[][]
    expect(
      eqCalls.find((c) => c[0] === "ordenes_servicio.sucursal_id" && c[1] === "suc-B")
    ).toBeTruthy()
  })

  it("ADMIN verTodas (no cookie) → no ordenes_servicio.sucursal_id eq on single-factura query", async () => {
    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie(null)

    const facturaData = {
      id: "f-1",
      orden_id: "o-1",
      numero_factura: 1,
      fecha: "2024-01-01",
      subtotal: 1000,
      iva: 0,
      total: 1000,
      monto_abonado: 0,
      estado_pago: "PENDIENTE",
      created_at: "2024-01-01",
      ordenes_servicio: {
        id: "o-1",
        numero_orden: 1,
        dispositivo: "iPhone",
        organization_id: "org-1",
        clientes: { nombre: "Test" },
      },
      pagos_parciales: [],
    }
    const facturasChain = createChainMock(facturaData)
    mockSupabaseFrom({ facturas: facturasChain })

    const res = await getFacturacionById(
      createGetRequest("http://localhost:3000/api/facturacion/f-1"),
      { params: Promise.resolve({ id: "f-1" }) }
    )

    expect(res.status).toBe(200)
    const eqCalls = vi.mocked(facturasChain.eq).mock.calls as any[][]
    expect(eqCalls.find((c) => c[0] === "ordenes_servicio.sucursal_id")).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// LEAK 3 — GET /api/search — RPC path + ILIKE fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("LEAK 3 — GET /api/search — RPC path branch filter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("TECNICO 'suc-A' → rpc called with p_sucursal_id: 'suc-A'", async () => {
    mockAuthWithSucursal({ role: "TECNICO", sucursalId: "suc-A" })
    mockCookie(null)

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { clientes: [], ordenes: [] }, error: null } as any)

    const res = await getSearch(createGetRequest("http://localhost:3000/api/search?q=test"))

    expect(res.status).toBe(200)
    const rpcArgs = vi.mocked(supabaseAdmin.rpc).mock.calls[0]
    expect(rpcArgs[0]).toBe("search_all")
    expect(rpcArgs[1]).toMatchObject({ p_sucursal_id: "suc-A" })
  })

  it("ADMIN verTodas (no cookie) → rpc called with p_sucursal_id: null", async () => {
    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie(null)

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { clientes: [], ordenes: [] }, error: null } as any)

    const res = await getSearch(createGetRequest("http://localhost:3000/api/search?q=test"))

    expect(res.status).toBe(200)
    const rpcArgs = vi.mocked(supabaseAdmin.rpc).mock.calls[0]
    expect(rpcArgs[0]).toBe("search_all")
    expect(rpcArgs[1]).toMatchObject({ p_sucursal_id: null })
  })
})

describe("LEAK 3 — GET /api/search — ILIKE fallback branch filter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("TECNICO 'suc-A' fallback → ordenes query gets .eq('sucursal_id', 'suc-A'), clientes does NOT", async () => {
    mockAuthWithSucursal({ role: "TECNICO", sucursalId: "suc-A" })
    mockCookie(null)

    // Make RPC fail to trigger fallback
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { message: "rpc not found" } } as any)

    const ordenesChain = createChainMock([])
    const clientesChain = createChainMock([])
    mockSupabaseFrom({
      ordenes_servicio: ordenesChain,
      clientes: clientesChain,
    })

    const res = await getSearch(createGetRequest("http://localhost:3000/api/search?q=test"))

    expect(res.status).toBe(200)

    // ordenes fallback must have sucursal_id filter
    const ordenesEqCalls = vi.mocked(ordenesChain.eq).mock.calls as any[][]
    expect(
      ordenesEqCalls.find((c) => c[0] === "sucursal_id" && c[1] === "suc-A")
    ).toBeTruthy()

    // clientes fallback must NOT have sucursal_id filter (org-wide)
    const clientesEqCalls = vi.mocked(clientesChain.eq).mock.calls as any[][]
    expect(clientesEqCalls.find((c) => c[0] === "sucursal_id")).toBeUndefined()
  })

  it("ADMIN verTodas fallback → ordenes query has no sucursal_id eq", async () => {
    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie(null)

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { message: "rpc not found" } } as any)

    const ordenesChain = createChainMock([])
    const clientesChain = createChainMock([])
    mockSupabaseFrom({
      ordenes_servicio: ordenesChain,
      clientes: clientesChain,
    })

    const res = await getSearch(createGetRequest("http://localhost:3000/api/search?q=test"))

    expect(res.status).toBe(200)

    const ordenesEqCalls = vi.mocked(ordenesChain.eq).mock.calls as any[][]
    expect(ordenesEqCalls.find((c) => c[0] === "sucursal_id")).toBeUndefined()
  })
})
