import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  parseResponse,
} from "./helpers"

import { GET } from "@/app/api/proveedores/[id]/catalogo/route"
import { PUT } from "@/app/api/proveedores/[id]/catalogo/[itemId]/route"

/**
 * precioReferencia is the supplier's purchase price for a catalogue line, and
 * the line carries inventarioId, so it resolves to the purchase cost of one
 * exact inventory item. It belongs behind the same permission as its two
 * siblings on the very same page (stats.valorCostoStock and
 * comparativa.precioCompra): hasInventarioAccess.
 *
 * The response also reports canViewCost, because precioReferencia is nullable
 * on its own — a null cell cannot tell the tab apart "no price loaded" from
 * "price hidden", and guessing wrong would hide the price input from an ADMIN
 * whose catalogue has no prices yet.
 */

function ctx(id = "prov-1") {
  return { params: Promise.resolve({ id }) }
}

function itemCtx(id = "prov-1", itemId = "item-1") {
  return { params: Promise.resolve({ id, itemId }) }
}

function mockRole(role: string) {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "u-1", organizationId: "org-1", role, email: "u@u.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

const catalogoRows = [
  {
    id: "item-1",
    proveedor_id: "prov-1",
    inventario_id: "inv-1",
    codigo_proveedor: "SKU-1",
    nombre: "Pantalla iPhone 12",
    descripcion: null,
    precio_referencia: 4500,
    moneda: "ARS",
    unidad: "unidad",
    notas: null,
    precio_actualizado_at: "2026-08-01T00:00:00.000Z",
    inventario: { id: "inv-1", codigo: "C1", nombre: "Pantalla iPhone 12" },
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  },
]

function wireSupabase(vendedoresHabilitados = false) {
  mockSupabaseFrom({
    proveedor_catalogo_items: createChainMock(catalogoRows),
    organizations: createChainMock({ vendedores_administran_inventario: vendedoresHabilitados }),
  })
}

describe("GET /api/proveedores/[id]/catalogo — reference price gated by hasInventarioAccess", () => {
  beforeEach(() => vi.clearAllMocks())

  it("includes precioReferencia for ADMIN (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wireSupabase()

    const res = await GET(createGetRequest(), ctx())
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.canViewCost).toBe(true)
    expect(body.items[0].precioReferencia).toBe(4500)
  })

  it("TECNICO no llega al catalogo: 403", async () => {
    // Antes este test verificaba que al TECNICO se le ocultara el precio de
    // referencia. Desde que las lecturas de proveedores van por
    // requireAdminOrVendedor no llega al handler, y la version "sin permiso
    // 275 no ve el costo" ya la cubre el test de VENDEDOR de aca abajo.
    mockRole("TECNICO")
    wireSupabase()

    const res = await GET(createGetRequest(), ctx())
    const { status } = await parseResponse(res)

    expect(status).toBe(403)
  })

  it("strips precioReferencia for VENDEDOR when the org did not opt in", async () => {
    mockRole("VENDEDOR")
    wireSupabase(false)

    const res = await GET(createGetRequest(), ctx())
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.canViewCost).toBe(false)
    expect(body.items[0].precioReferencia).toBeNull()
  })

  it("includes precioReferencia for VENDEDOR when the org opted in", async () => {
    mockRole("VENDEDOR")
    wireSupabase(true)

    const res = await GET(createGetRequest(), ctx())
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.canViewCost).toBe(true)
    expect(body.items[0].precioReferencia).toBe(4500)
  })
})

describe("PUT /api/proveedores/[id]/catalogo/[itemId] — echo respects the same gate", () => {
  beforeEach(() => vi.clearAllMocks())

  it("does not echo the stored price back to a VENDEDOR without inventario access", async () => {
    mockRole("VENDEDOR")
    mockSupabaseFrom({
      proveedor_catalogo_items: createChainMock(catalogoRows[0]),
      organizations: createChainMock({ vendedores_administran_inventario: false }),
    })

    const req = new Request("http://localhost:3000/api/test", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: "Pantalla iPhone 12 Pro" }),
    })
    const res = await PUT(req, itemCtx())
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.precioReferencia).toBeNull()
    expect(body.nombre).toBe("Pantalla iPhone 12")
  })
})
