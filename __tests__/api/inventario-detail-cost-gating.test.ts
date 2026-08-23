import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  parseResponse,
} from "./helpers"

import { GET } from "@/app/api/inventario/[id]/route"

function ctx(id = "inv-1") {
  return { params: Promise.resolve({ id }) }
}

function mockTecnico() {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "tecnico-1", organizationId: "org-1", role: "TECNICO", email: "t@t.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

function mockVendedor() {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "vendedor-1", organizationId: "org-1", role: "VENDEDOR", email: "v@v.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

const itemRow = {
  id: "inv-1",
  codigo: "C1",
  nombre: "Pantalla",
  descripcion: null,
  categoria: "Repuestos",
  tipo_dispositivo: "CELULAR",
  stock: 5,
  stock_reservado: 0,
  precio_compra: 300,
  precio_venta: 900,
}

describe("GET /api/inventario/[id] — cost visibility gated by hasInventarioAccess", () => {
  beforeEach(() => vi.clearAllMocks())

  it("includes precioCompra for ADMIN (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ inventario: createChainMock(itemRow) })

    const res = await GET(createGetRequest(), ctx())
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.precioCompra).toBe(300)
  })

  it("strips precioCompra for TECNICO", async () => {
    mockTecnico()
    mockSupabaseFrom({ inventario: createChainMock(itemRow) })

    const res = await GET(createGetRequest(), ctx())
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.precioCompra).toBeNull()
    expect(body.nombre).toBe("Pantalla")
  })

  it("strips precioCompra for VENDEDOR without the org's inventario opt-in", async () => {
    mockVendedor()
    mockSupabaseFrom({
      inventario: createChainMock(itemRow),
      organizations: createChainMock({ vendedores_administran_inventario: false }),
    })

    const res = await GET(createGetRequest(), ctx())
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.precioCompra).toBeNull()
  })
})
