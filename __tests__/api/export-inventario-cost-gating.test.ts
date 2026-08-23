import { describe, it, expect, beforeEach, vi } from "vitest"
import { NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

import { GET } from "@/app/api/export/[entity]/route"

/**
 * /api/export/inventario runs behind plain requireAuth() and renders
 * INVENTARIO_COLUMNS, which carries precio_compra -> "Precio Compra". The
 * ExportButton sits on the inventory list itself, so a TECNICO (or a VENDEDOR
 * in an org that never opted in) could download every purchase cost the rest
 * of the gate closed off.
 *
 * The column is declared in lib/csv-export.ts, not in the route, which is why
 * the route-by-route sweep missed it. Gate drops the cost column instead of
 * refusing the whole export — data portability is not plan- or role-gated.
 */

const INVENTARIO_ROW = {
  id: "i1",
  codigo: "ABC123",
  nombre: "Pantalla",
  descripcion: "",
  categoria: "Pantallas",
  tipo_dispositivo: "CELULAR",
  stock: 10,
  precio_compra: 1234.5,
  precio_venta: 5678.9,
  proveedor: "Proveedor SA",
}

function exportRequest(entity: string, query = "") {
  const url = `http://localhost:3000/api/export/${entity}${query}`
  return {
    req: new NextRequest(url),
    ctx: { params: Promise.resolve({ entity }) },
  }
}

function mockVendedor() {
  vi.mocked(auth).mockResolvedValue({
    user: {
      id: "vendedor-1",
      organizationId: "org-1",
      role: "VENDEDOR",
      sucursalId: null,
      email: "v@v.com",
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

async function exportInventarioCSV(vendedoresHabilitados = false) {
  mockSupabaseFrom({
    inventario: createChainMock([INVENTARIO_ROW]),
    organizations: createChainMock({
      vendedores_administran_inventario: vendedoresHabilitados,
    }),
    sucursales: createChainMock([]),
  })
  const { req, ctx } = exportRequest("inventario")
  const res = await GET(req, ctx)
  return { status: res.status, csv: await res.text() }
}

describe("GET /api/export/inventario — purchase cost column follows hasInventarioAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("drops the Precio Compra column for TECNICO but still exports the rest", async () => {
    mockAuthSuccess({ role: "TECNICO" })

    const { status, csv } = await exportInventarioCSV()

    expect(status).toBe(200)
    expect(csv).not.toContain("Precio Compra")
    expect(csv).not.toContain("1234.50")
    // Portability is preserved: everything that is not cost still exports.
    expect(csv).toContain("Precio Venta")
    expect(csv).toContain("5678.90")
    expect(csv).toContain("Pantalla")
  })

  it("drops the Precio Compra column for VENDEDOR without the org opt-in", async () => {
    mockVendedor()

    const { status, csv } = await exportInventarioCSV(false)

    expect(status).toBe(200)
    expect(csv).not.toContain("Precio Compra")
    expect(csv).not.toContain("1234.50")
  })

  it("keeps the Precio Compra column for VENDEDOR when the org opted in", async () => {
    mockVendedor()

    const { status, csv } = await exportInventarioCSV(true)

    expect(status).toBe(200)
    expect(csv).toContain("Precio Compra")
    expect(csv).toContain("1234.50")
  })

  it("keeps the Precio Compra column for ADMIN", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const { status, csv } = await exportInventarioCSV()

    expect(status).toBe(200)
    expect(csv).toContain("Precio Compra")
    expect(csv).toContain("1234.50")
  })
})
