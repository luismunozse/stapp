import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  parseResponse,
} from "./helpers"

import { GET } from "@/app/api/inventario/[id]/analytics/route"

function ctx(id = "inv-1") {
  return { params: Promise.resolve({ id }) }
}

function mockTecnico() {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "tecnico-1", organizationId: "org-1", role: "TECNICO", email: "t@t.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

const itemRow = {
  id: "inv-1",
  nombre: "Pantalla",
  stock: 10,
  stock_reservado: 2,
  stock_minimo: 3,
  punto_reorden: null,
  precio_compra: 300,
  precio_venta: 900,
}

function wireSupabase() {
  mockSupabaseFrom({
    inventario: createChainMock(itemRow),
    movimientos_inventario: createChainMock([]),
  })
}

describe("GET /api/inventario/[id]/analytics — cost visibility gated by hasInventarioAccess", () => {
  beforeEach(() => vi.clearAllMocks())

  it("includes valorStock (cost-derived) for ADMIN (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wireSupabase()

    const res = await GET(createGetRequest(), ctx())
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.valorStock).toBe(3000) // 10 * 300
  })

  it("strips valorStock for TECNICO but keeps sales/stock analytics", async () => {
    mockTecnico()
    wireSupabase()

    const res = await GET(createGetRequest(), ctx())
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.valorStock).toBeNull()
    expect(body.disponible).toBe(8)
  })
})
