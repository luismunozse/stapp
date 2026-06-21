/**
 * Regression tests: VENDEDOR sees ZERO rows in report endpoints
 * because requireAdminOrVendedor calls sucursalParaLectura with
 * userSucursalId hardcoded to null → sentinel SUCURSAL_NINGUNA → 0 rows.
 *
 * Fix: pass session!.user.sucursalId ?? null instead of null.
 *
 * Endpoints covered:
 *   - GET /api/reportes/ingresos      (filters facturas via ordenes_servicio.sucursal_id)
 *   - GET /api/reportes/ventas-analytics (filters ventas via sucursal_id)
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { cookies } from "next/headers"
import { mockSupabaseFrom, createChainMock, createGetRequest } from "./helpers"
import { SUCURSAL_NINGUNA } from "@/lib/sucursal"

import { GET as getIngresos } from "@/app/api/reportes/ingresos/route"
import { GET as getVentasAnalytics } from "@/app/api/reportes/ventas-analytics/route"

// ─── Cookie mock ──────────────────────────────────────────────────────────────

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
// GET /api/reportes/ingresos
//
// Query: supabaseAdmin.from("facturas").select(...)
//        .eq("ordenes_servicio.organization_id", organizationId)
//        .eq("estado_pago", "PAGADO")
//        ...
// Branch filter (when applied):
//        .eq("ordenes_servicio.sucursal_id", filtro.sucursalId)
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/reportes/ingresos — VENDEDOR branch filter regression", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("VENDEDOR with sucursalId 'suc-A' → facturas query receives .eq('ordenes_servicio.sucursal_id', 'suc-A') NOT sentinel", async () => {
    mockAuthWithSucursal({ role: "VENDEDOR", sucursalId: "suc-A" })
    mockCookie(null)

    const facturasChain = createChainMock([])
    mockSupabaseFrom({ facturas: facturasChain })

    const req = createGetRequest("http://localhost:3000/api/reportes/ingresos")
    const res = await getIngresos(req)

    expect(res.status).toBe(200)

    const eqCalls = vi.mocked(facturasChain.eq).mock.calls as any[][]

    // Must have the branch filter with the REAL sucursal id
    expect(
      eqCalls.find((c) => c[0] === "ordenes_servicio.sucursal_id" && c[1] === "suc-A")
    ).toBeTruthy()

    // Must NOT have applied the sentinel (which means 0 rows — the regression)
    expect(
      eqCalls.find((c) => c[0] === "ordenes_servicio.sucursal_id" && c[1] === SUCURSAL_NINGUNA)
    ).toBeUndefined()
  })

  it("ADMIN verTodas (no cookie) → no ordenes_servicio.sucursal_id eq applied", async () => {
    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie(null)

    const facturasChain = createChainMock([])
    mockSupabaseFrom({ facturas: facturasChain })

    const req = createGetRequest("http://localhost:3000/api/reportes/ingresos")
    const res = await getIngresos(req)

    expect(res.status).toBe(200)

    const eqCalls = vi.mocked(facturasChain.eq).mock.calls as any[][]
    expect(eqCalls.find((c) => c[0] === "ordenes_servicio.sucursal_id")).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reportes/ventas-analytics
//
// Queries: supabaseAdmin.from("ventas"), supabaseAdmin.from("items_venta")
// Branch filter on ventas (when applied):
//        .eq("sucursal_id", filtro.sucursalId)
// Branch filter on items_venta queries (when applied):
//        .eq("ventas.sucursal_id", filtro.sucursalId)
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/reportes/ventas-analytics — VENDEDOR branch filter regression", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("VENDEDOR with sucursalId 'suc-A' → ventas query receives .eq('sucursal_id', 'suc-A') NOT sentinel", async () => {
    mockAuthWithSucursal({ role: "VENDEDOR", sucursalId: "suc-A" })
    mockCookie(null)

    const ventasChain = createChainMock([])
    const itemsVentaChain = createChainMock([])
    const usersChain = createChainMock([])
    mockSupabaseFrom({
      ventas: ventasChain,
      items_venta: itemsVentaChain,
      users: usersChain,
    })

    const res = await getVentasAnalytics()

    expect(res.status).toBe(200)

    const eqCalls = vi.mocked(ventasChain.eq).mock.calls as any[][]

    // Must have the branch filter with the REAL sucursal id on the ventas table
    expect(
      eqCalls.find((c) => c[0] === "sucursal_id" && c[1] === "suc-A")
    ).toBeTruthy()

    // Must NOT have applied the sentinel (which means 0 rows — the regression)
    expect(
      eqCalls.find((c) => c[0] === "sucursal_id" && c[1] === SUCURSAL_NINGUNA)
    ).toBeUndefined()
  })

  it("ADMIN verTodas (no cookie) → ventas query has no sucursal_id eq applied", async () => {
    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie(null)

    const ventasChain = createChainMock([])
    const itemsVentaChain = createChainMock([])
    const usersChain = createChainMock([])
    mockSupabaseFrom({
      ventas: ventasChain,
      items_venta: itemsVentaChain,
      users: usersChain,
    })

    const res = await getVentasAnalytics()

    expect(res.status).toBe(200)

    const eqCalls = vi.mocked(ventasChain.eq).mock.calls as any[][]
    expect(eqCalls.find((c) => c[0] === "sucursal_id")).toBeUndefined()
  })
})
