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
  derivarLecturaVenta,
  getNombreSucursal,
  resolverIndicadorVenta,
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

    expect(result).toEqual({
      sucursalId: "suc-principal",
      depositoId: "dep-principal",
      unassignedSucursal: false,
    })
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

    expect(result).toEqual({
      sucursalId: "suc-principal",
      depositoId: null,
      unassignedSucursal: false,
    })
  })

  it("DV-5 — org sin sucursal principal: sucursalId y depositoId null", async () => {
    mockSucursalesYDepositos({ principalSucursalId: null })

    const result = await resolverDestinoVenta({
      role: "ADMIN",
      organizationId: "org-1",
      userSucursalId: null,
    })

    expect(result).toEqual({ sucursalId: null, depositoId: null, unassignedSucursal: false })
  })

  it("DV-6 — no-ADMIN sin sucursal asignada: marca unassignedSucursal, pero la escritura sigue cayendo a la principal", async () => {
    mockSucursalesYDepositos({ principalSucursalId: "suc-principal", depositoId: "dep-principal" })

    const result = await resolverDestinoVenta({
      role: "VENDEDOR",
      organizationId: "org-1",
      userSucursalId: null,
    })

    expect(result.unassignedSucursal).toBe(true)
    // The write path keeps its principal fallback — only reads go fail-closed.
    expect(result.sucursalId).toBe("suc-principal")
  })

  it("DV-7 — no-ADMIN con sucursal asignada: unassignedSucursal false", async () => {
    mockSucursalesYDepositos({ principalSucursalId: "suc-principal", depositoId: "dep-B" })

    const result = await resolverDestinoVenta({
      role: "VENDEDOR",
      organizationId: "org-1",
      userSucursalId: "suc-B",
    })

    expect(result).toEqual({ sucursalId: "suc-B", depositoId: "dep-B", unassignedSucursal: false })
  })

  it("DV-8 — ADMIN sin sucursal asignada: NO es unassigned (asimetria ADMIN / no-ADMIN)", async () => {
    mockSucursalesYDepositos({ principalSucursalId: "suc-principal", depositoId: "dep-principal" })

    const result = await resolverDestinoVenta({
      role: "ADMIN",
      organizationId: "org-1",
      userSucursalId: null,
    })

    expect(result.unassignedSucursal).toBe(false)
  })
})

describe("derivarLecturaVenta", () => {
  it("LV-1 — no-ADMIN sin sucursal asignada: fail-closed (sentinel, sin deposito, sin agregado)", () => {
    const lectura = derivarLecturaVenta({
      sucursalId: "suc-principal",
      depositoId: "dep-principal",
      unassignedSucursal: true,
    })

    expect(lectura).toEqual({
      sucursalId: SUCURSAL_NINGUNA,
      depositoId: null,
      verTodas: false,
      ventaSucursalId: null,
    })
  })

  it("LV-2 — destino con deposito concreto: lectura escopeada a ese deposito", () => {
    const lectura = derivarLecturaVenta({
      sucursalId: "suc-A",
      depositoId: "dep-A",
      unassignedSucursal: false,
    })

    expect(lectura).toEqual({
      sucursalId: "suc-A",
      depositoId: "dep-A",
      verTodas: false,
      ventaSucursalId: "suc-A",
    })
  })

  it("LV-3 — destino sin deposito (modo drenaje): lectura agregada org-wide", () => {
    const lectura = derivarLecturaVenta({
      sucursalId: "suc-A",
      depositoId: null,
      unassignedSucursal: false,
    })

    expect(lectura.verTodas).toBe(true)
  })

  it("LV-4 — modo drenaje: NO nombra una sucursal (el RPC puede drenar de cualquier deposito)", () => {
    const lectura = derivarLecturaVenta({
      sucursalId: "suc-A",
      depositoId: null,
      unassignedSucursal: false,
    })

    // descontar_stock_deposito(..., strict=false) puede tomar unidades del
    // deposito de cualquier otra sucursal: afirmar "vendiendo desde suc-A"
    // seria mentira. El escopeo de la lectura sigue apuntando a la sucursal.
    expect(lectura.ventaSucursalId).toBeNull()
    expect(lectura.sucursalId).toBe("suc-A")
  })
})

// ─── resolverIndicadorVenta ───
//
// The POS "Vendiendo desde" indicator is gated server-side: the browser cannot
// read the httpOnly sucursal cookie, and the localStorage mirror only exists
// once an ADMIN has actively used the switcher — which single-sucursal orgs
// never can, because SucursalSwitcher renders null for them.

function mockListaSucursales(sucursales: Array<{ id: string; nombre: string }>) {
  const chain: any = {}
  for (const m of ["select", "eq", "is"]) chain[m] = vi.fn().mockReturnValue(chain)
  chain.then = (resolve: any, reject?: any) =>
    Promise.resolve({ data: sucursales, error: null }).then(resolve, reject)

  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "sucursales") return chain
    return createUnusedChain()
  })
  return chain
}

function createUnusedChain(): any {
  const chain: any = {}
  for (const m of ["select", "eq", "is"]) chain[m] = vi.fn().mockReturnValue(chain)
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null })
  return chain
}

const DOS_SUCURSALES = [
  { id: "suc-principal", nombre: "Casa Central" },
  { id: "suc-B", nombre: "Sucursal Norte" },
]

describe("resolverIndicadorVenta", () => {
  beforeEach(() => vi.clearAllMocks())

  it("IV-1 — ADMIN sin cookie en org multi-sucursal: devuelve el nombre", async () => {
    mockListaSucursales(DOS_SUCURSALES)

    const nombre = await resolverIndicadorVenta({
      role: "ADMIN",
      organizationId: "org-1",
      cookieSucursalId: null,
      ventaSucursalId: "suc-principal",
    })

    expect(nombre).toBe("Casa Central")
  })

  it('IV-2 — ADMIN con cookie "todas" en org multi-sucursal: devuelve el nombre', async () => {
    mockListaSucursales(DOS_SUCURSALES)

    const nombre = await resolverIndicadorVenta({
      role: "ADMIN",
      organizationId: "org-1",
      cookieSucursalId: "todas",
      ventaSucursalId: "suc-B",
    })

    expect(nombre).toBe("Sucursal Norte")
  })

  it("IV-3 — org de UNA sola sucursal: null (el switcher ni se renderiza, no hay nada que desambiguar)", async () => {
    mockListaSucursales([{ id: "suc-principal", nombre: "Casa Central" }])

    const nombre = await resolverIndicadorVenta({
      role: "ADMIN",
      organizationId: "org-1",
      cookieSucursalId: null,
      ventaSucursalId: "suc-principal",
    })

    expect(nombre).toBeNull()
  })

  it("IV-4 — ADMIN con una sucursal concreta seleccionada: null (el selector ya la muestra) y sin query", async () => {
    mockListaSucursales(DOS_SUCURSALES)

    const nombre = await resolverIndicadorVenta({
      role: "ADMIN",
      organizationId: "org-1",
      cookieSucursalId: "suc-B",
      ventaSucursalId: "suc-B",
    })

    expect(nombre).toBeNull()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it("IV-5 — no-ADMIN: null sin query (nunca ve mas de una sucursal a la vez)", async () => {
    mockListaSucursales(DOS_SUCURSALES)

    const nombre = await resolverIndicadorVenta({
      role: "VENDEDOR",
      organizationId: "org-1",
      cookieSucursalId: null,
      ventaSucursalId: "suc-B",
    })

    expect(nombre).toBeNull()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it("IV-6 — sin ventaSucursalId (drenaje o fail-closed): null sin query", async () => {
    mockListaSucursales(DOS_SUCURSALES)

    const nombre = await resolverIndicadorVenta({
      role: "ADMIN",
      organizationId: "org-1",
      cookieSucursalId: null,
      ventaSucursalId: null,
    })

    expect(nombre).toBeNull()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it("IV-7 — la sucursal resuelta no esta en la lista: null en vez de un nombre inventado", async () => {
    mockListaSucursales(DOS_SUCURSALES)

    const nombre = await resolverIndicadorVenta({
      role: "ADMIN",
      organizationId: "org-1",
      cookieSucursalId: null,
      ventaSucursalId: "suc-fantasma",
    })

    expect(nombre).toBeNull()
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
