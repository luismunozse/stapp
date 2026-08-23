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

function mockTecnico() {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "tecnico-1", organizationId: "org-1", role: "TECNICO", email: "t@t.com" },
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

  it("strips precioCompra comparison for TECNICO", async () => {
    mockTecnico()
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
