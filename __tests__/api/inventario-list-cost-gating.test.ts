import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  parseResponse,
} from "./helpers"

import { GET } from "@/app/api/inventario/route"

function mockVendedor() {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "vendedor-1", organizationId: "org-1", role: "VENDEDOR", email: "v@v.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

function mockTecnico() {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "tecnico-1", organizationId: "org-1", role: "TECNICO", email: "t@t.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

const inventarioRow = {
  id: "inv-1",
  codigo: "C1",
  nombre: "Pantalla",
  descripcion: null,
  categoria: "Repuestos",
  tipo_dispositivo: "CELULAR",
  stock: 10,
  stock_reservado: 0,
  precio_compra: 300,
  precio_venta: 900,
  proveedor: null,
  proveedor_id: null,
}

describe("GET /api/inventario — cost visibility gated by hasInventarioAccess", () => {
  beforeEach(() => vi.clearAllMocks())

  it("includes precioCompra for ADMIN (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const invChain = createChainMock([inventarioRow], null, 1)
    mockSupabaseFrom({ inventario: invChain })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.data[0].precioCompra).toBe(300)
  })

  it("strips precioCompra for TECNICO — never gets inventario cost access", async () => {
    mockTecnico()
    const invChain = createChainMock([inventarioRow], null, 1)
    mockSupabaseFrom({ inventario: invChain })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.data[0].precioCompra).toBeNull()
  })

  it("strips precioCompra for VENDEDOR when the org has NOT opted in", async () => {
    mockVendedor()
    const invChain = createChainMock([inventarioRow], null, 1)
    const orgChain = createChainMock({ vendedores_administran_inventario: false })
    mockSupabaseFrom({ inventario: invChain, organizations: orgChain })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.data[0].precioCompra).toBeNull()
  })

  it("includes precioCompra for VENDEDOR when the org opted in", async () => {
    mockVendedor()
    const invChain = createChainMock([inventarioRow], null, 1)
    const orgChain = createChainMock({ vendedores_administran_inventario: true })
    mockSupabaseFrom({ inventario: invChain, organizations: orgChain })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.data[0].precioCompra).toBe(300)
  })
})
