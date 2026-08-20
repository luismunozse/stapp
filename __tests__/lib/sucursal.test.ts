/**
 * Tests: resolveSucursalLectura — branch-scoping logic.
 *
 * Scenarios:
 *  SL-1 — non-admin with null userSucursalId: must return SUCURSAL_NINGUNA (fail-closed, not leak)
 *  SL-2 — non-admin with a real branch id: returns that id, verTodas false
 *  SL-3 — ADMIN without cookie / "todas" cookie: returns { sucursalId: null, verTodas: true }
 *  SL-4 — ADMIN with specific cookie id: returns that id, verTodas false
 *
 * Also covers resolverDestinoVenta / getNombreSucursal — the shared helper
 * used by the ventas write route and the POS read endpoints (search/
 * barcode/check-stock via scope=venta) to agree on which sucursal/deposito
 * a sale draws stock from.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"
import {
  resolveSucursalLectura,
  resolverDestinoVenta,
  getNombreSucursal,
  SUCURSAL_NINGUNA,
} from "@/lib/sucursal"

function mockCookie(value: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) => (name === "stapp-sucursal-activa" && value ? { value } : undefined)),
    set: vi.fn(),
  } as any)
}

describe("resolveSucursalLectura", () => {
  it("SL-1 — TECNICO with null sucursalId returns SUCURSAL_NINGUNA (fail-closed, not data-leak)", () => {
    const result = resolveSucursalLectura({
      role: "TECNICO",
      userSucursalId: null,
      cookieSucursalId: null,
    })
    expect(result).toEqual({ sucursalId: SUCURSAL_NINGUNA, verTodas: false })
  })

  it("SL-1b — VENDEDOR with null sucursalId also returns SUCURSAL_NINGUNA", () => {
    const result = resolveSucursalLectura({
      role: "VENDEDOR",
      userSucursalId: null,
      cookieSucursalId: null,
    })
    expect(result).toEqual({ sucursalId: SUCURSAL_NINGUNA, verTodas: false })
  })

  it("SL-2 — non-admin with a real sucursalId: returns that id, verTodas false", () => {
    const result = resolveSucursalLectura({
      role: "TECNICO",
      userSucursalId: "suc-real",
      cookieSucursalId: null,
    })
    expect(result).toEqual({ sucursalId: "suc-real", verTodas: false })
  })

  it("SL-3a — ADMIN with no cookie: verTodas true, sucursalId null", () => {
    const result = resolveSucursalLectura({
      role: "ADMIN",
      userSucursalId: null,
      cookieSucursalId: null,
    })
    expect(result).toEqual({ sucursalId: null, verTodas: true })
  })

  it('SL-3b — ADMIN with "todas" cookie: verTodas true, sucursalId null', () => {
    const result = resolveSucursalLectura({
      role: "ADMIN",
      userSucursalId: null,
      cookieSucursalId: "todas",
    })
    expect(result).toEqual({ sucursalId: null, verTodas: true })
  })

  it("SL-4 — ADMIN with specific cookie id: returns that id, verTodas false", () => {
    const result = resolveSucursalLectura({
      role: "ADMIN",
      userSucursalId: null,
      cookieSucursalId: "suc-cookie",
    })
    expect(result).toEqual({ sucursalId: "suc-cookie", verTodas: false })
  })
})

// ─── resolverDestinoVenta / getNombreSucursal ───

function mockSucursalesYDepositos(opts: {
  principalSucursalId?: string | null
  depositoId?: string | null
  nombre?: string
}) {
  const sucursalesChain: any = {}
  for (const m of ["select", "eq", "is"]) sucursalesChain[m] = vi.fn().mockReturnValue(sucursalesChain)
  sucursalesChain.single = vi.fn().mockResolvedValue({
    data:
      opts.principalSucursalId === null
        ? null
        : { id: opts.principalSucursalId ?? "suc-principal", nombre: opts.nombre ?? "Sucursal Centro" },
    error: null,
  })

  const depositosChain: any = {}
  for (const m of ["select", "eq", "is"]) depositosChain[m] = vi.fn().mockReturnValue(depositosChain)
  depositosChain.maybeSingle = vi.fn().mockResolvedValue({
    data: opts.depositoId ? { id: opts.depositoId } : null,
    error: null,
  })

  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "sucursales") return sucursalesChain
    if (table === "depositos") return depositosChain
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: null, error: null }) } as any
  })
}

describe("resolverDestinoVenta", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookie(null)
  })

  it("DV-1 — ADMIN sin cookie: resuelve la sucursal principal y su deposito", async () => {
    mockSucursalesYDepositos({ principalSucursalId: "suc-principal", depositoId: "dep-principal" })

    const result = await resolverDestinoVenta({
      role: "ADMIN",
      organizationId: "org-1",
      userSucursalId: null,
    })

    expect(result).toEqual({ sucursalId: "suc-principal", depositoId: "dep-principal" })
  })

  it('DV-2 — ADMIN con cookie "todas": igual resuelve la principal (mismo comportamiento que sucursalParaEscritura)', async () => {
    mockCookie("todas")
    mockSucursalesYDepositos({ principalSucursalId: "suc-principal", depositoId: "dep-principal" })

    const result = await resolverDestinoVenta({
      role: "ADMIN",
      organizationId: "org-1",
      userSucursalId: null,
    })

    expect(result.sucursalId).toBe("suc-principal")
  })

  it("DV-3 — ADMIN con cookie de sucursal especifica: usa esa sucursal, no la principal", async () => {
    mockCookie("suc-B")
    mockSucursalesYDepositos({ principalSucursalId: "suc-principal", depositoId: "dep-B" })

    const result = await resolverDestinoVenta({
      role: "ADMIN",
      organizationId: "org-1",
      userSucursalId: null,
    })

    expect(result.sucursalId).toBe("suc-B")
  })

  it("DV-4 — sucursal sin deposito principal: depositoId null (modo drenaje), sin excepcion", async () => {
    mockSucursalesYDepositos({ principalSucursalId: "suc-principal", depositoId: null })

    const result = await resolverDestinoVenta({
      role: "ADMIN",
      organizationId: "org-1",
      userSucursalId: null,
    })

    expect(result).toEqual({ sucursalId: "suc-principal", depositoId: null })
  })

  it("DV-5 — org sin sucursal principal: sucursalId y depositoId null", async () => {
    mockSucursalesYDepositos({ principalSucursalId: null })

    const result = await resolverDestinoVenta({
      role: "ADMIN",
      organizationId: "org-1",
      userSucursalId: null,
    })

    expect(result).toEqual({ sucursalId: null, depositoId: null })
  })
})

describe("getNombreSucursal", () => {
  beforeEach(() => vi.clearAllMocks())

  it("devuelve el nombre cuando la sucursal existe", async () => {
    mockSucursalesYDepositos({ principalSucursalId: "suc-A", nombre: "Sucursal Palermo" })

    const nombre = await getNombreSucursal("org-1", "suc-A")

    expect(nombre).toBe("Sucursal Palermo")
  })

  it("devuelve null cuando no hay datos", async () => {
    mockSucursalesYDepositos({ principalSucursalId: null })

    const nombre = await getNombreSucursal("org-1", "suc-inexistente")

    expect(nombre).toBeNull()
  })
})
