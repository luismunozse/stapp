import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  parseResponse,
} from "./helpers"

import { GET } from "@/app/api/inventario/check-duplicate/route"

function mockTecnico() {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "tecnico-1", organizationId: "org-1", role: "TECNICO", email: "t@t.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

const rows = [
  {
    id: "inv-1",
    codigo: "C1",
    nombre: "Pantalla iPhone 12",
    categoria: "Repuestos",
    tipo_dispositivo: "CELULAR",
    stock: 5,
    precio_compra: 300,
    precio_venta: 900,
    proveedor_id: "p1",
    proveedores: { id: "p1", nombre: "Proveedor A" },
  },
]

describe("GET /api/inventario/check-duplicate — cost visibility gated by hasInventarioAccess", () => {
  beforeEach(() => vi.clearAllMocks())

  it("includes precioCompra for ADMIN (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ inventario: createChainMock(rows) })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/check-duplicate?nombre=Pantalla+iPhone+12"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.matches[0].precioCompra).toBe(300)
  })

  it("strips precioCompra for TECNICO", async () => {
    mockTecnico()
    mockSupabaseFrom({ inventario: createChainMock(rows) })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/check-duplicate?nombre=Pantalla+iPhone+12"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.matches[0].precioCompra).toBeNull()
    expect(body.matches[0].nombre).toBe("Pantalla iPhone 12")
  })
})
