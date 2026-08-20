import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  parseResponse,
} from "./helpers"

import { GET } from "@/app/api/inventario/[id]/historial-precios/route"

function ctx(id = "inv-1") {
  return { params: Promise.resolve({ id }) }
}

function mockTecnico() {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "tecnico-1", organizationId: "org-1", role: "TECNICO", email: "t@t.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

const itemRow = { id: "inv-1" }
const historialRows = [
  {
    id: "h1",
    inventario_id: "inv-1",
    precio_compra_anterior: 250,
    precio_compra_nuevo: 300,
    precio_venta_anterior: 800,
    precio_venta_nuevo: 900,
    motivo: "Ajuste proveedor",
    usuario_id: "user-1",
    users: { id: "user-1", nombre: "Admin" },
    created_at: "2026-01-01T00:00:00Z",
  },
]

function wireSupabase() {
  mockSupabaseFrom({
    inventario: createChainMock(itemRow),
    historial_precios: createChainMock(historialRows, null, 1),
  })
}

describe("GET /api/inventario/[id]/historial-precios — cost visibility gated by hasInventarioAccess", () => {
  beforeEach(() => vi.clearAllMocks())

  it("includes precioCompraAnterior/Nuevo for ADMIN (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wireSupabase()

    const res = await GET(createGetRequest(), ctx())
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.data[0].precioCompraAnterior).toBe(250)
    expect(body.data[0].precioCompraNuevo).toBe(300)
  })

  it("strips precioCompraAnterior/Nuevo for TECNICO but keeps precioVenta history", async () => {
    mockTecnico()
    wireSupabase()

    const res = await GET(createGetRequest(), ctx())
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.data[0].precioCompraAnterior).toBeNull()
    expect(body.data[0].precioCompraNuevo).toBeNull()
    expect(body.data[0].precioVentaAnterior).toBe(800)
    expect(body.data[0].precioVentaNuevo).toBe(900)
  })
})
