import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  parseResponse,
} from "./helpers"

import { GET } from "@/app/api/proveedores/[id]/comparativa/route"

function ctx(id = "prov-1") {
  return { params: Promise.resolve({ id }) }
}

function mockVendedorSinInventario() {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "vendedor-1", organizationId: "org-1", role: "VENDEDOR", email: "v@v.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

const provRow = { id: "prov-1", nombre: "Proveedor A" }
const itemRows = [
  {
    id: "inv-1",
    codigo: "C1",
    nombre: "Pantalla",
    stock: 5,
    precio_compra: 300,
    precio_venta: 900,
    proveedor_id: "prov-1",
    proveedores: { id: "prov-1", nombre: "Proveedor A" },
  },
  {
    id: "inv-2",
    codigo: "C1",
    nombre: "Pantalla",
    stock: 2,
    precio_compra: 280,
    precio_venta: 850,
    proveedor_id: "prov-2",
    proveedores: { id: "prov-2", nombre: "Proveedor B" },
  },
]

function wireSupabase() {
  mockSupabaseFrom({
    proveedores: createChainMock(provRow),
    inventario: createChainMock(itemRows),
  })
}

describe("GET /api/proveedores/[id]/comparativa — cost visibility gated by hasInventarioAccess", () => {
  beforeEach(() => vi.clearAllMocks())

  it("includes precioCompra comparison for ADMIN (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wireSupabase()

    const res = await GET(createGetRequest(), ctx())
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.items[0].mine.precioCompra).toBe(300)
    expect(body.items[0].others[0].precioCompra).toBe(280)
    expect(body.items[0].minPrecioCompra).toBe(280)
  })

  it("strips precioCompra comparison for VENDEDOR without inventario opt-in", async () => {
    // El actor era TECNICO, pero desde que las lecturas de proveedores van
    // por requireAdminOrVendedor el tecnico no llega hasta aca: recibe 403,
    // cubierto en proveedores-acceso.test.ts. Lo que este test fija es OTRO
    // eje —ocultar el costo a quien no tiene el permiso 275— y el actor que
    // lo representa ahora es un VENDEDOR sin opt-in.
    mockVendedorSinInventario()
    wireSupabase()

    const res = await GET(createGetRequest(), ctx())
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.items[0].mine.precioCompra).toBeNull()
    expect(body.items[0].others[0].precioCompra).toBeNull()
    expect(body.items[0].minPrecioCompra).toBeNull()
    // Identity/stock data (not cost) stays visible.
    expect(body.items[0].codigo).toBe("C1")
  })
})
