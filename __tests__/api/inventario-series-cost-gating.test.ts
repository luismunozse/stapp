import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  parseResponse,
} from "./helpers"

import { GET as getSeries } from "@/app/api/inventario/[id]/series/route"

function mockRole(role: string) {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "user-1", organizationId: "org-1", role, email: "u@u.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

// For a serialized item costo_unitario IS the exact precio_compra of that unit,
// so it follows the same rule as the sibling /lotes endpoint.
describe("GET /api/inventario/[id]/series — per-unit cost gated by hasInventarioAccess", () => {
  beforeEach(() => vi.clearAllMocks())

  const serieRows = [
    {
      id: "serie-1",
      numero_serie: "SN-001",
      lote_id: null,
      estado: "DISPONIBLE",
      fecha_recepcion: "2026-01-01",
      fecha_venta: null,
      fecha_garantia_vence: null,
      venta_id: null,
      cliente_id: null,
      deposito_id: null,
      costo_unitario: 250,
      notas: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ]

  function ctx(id = "inv-1") {
    return { params: Promise.resolve({ id }) }
  }

  function wire(vendedoresAdministranInventario = false) {
    mockSupabaseFrom({
      inventario_series: createChainMock(serieRows),
      organizations: createChainMock({
        vendedores_administran_inventario: vendedoresAdministranInventario,
      }),
    })
  }

  it("ADMIN sees costo_unitario (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wire()

    const { status, body } = await parseResponse(await getSeries(createGetRequest(), ctx()))

    expect(status).toBe(200)
    expect(body.data[0].costo_unitario).toBe(250)
  })

  it("TECNICO — costo_unitario stripped, serial tracking data intact", async () => {
    mockRole("TECNICO")
    wire()

    const { status, body } = await parseResponse(await getSeries(createGetRequest(), ctx()))

    expect(status).toBe(200)
    expect(body.data[0].costo_unitario).toBeNull()
    expect(body.data[0].numero_serie).toBe("SN-001")
    expect(body.data[0].estado).toBe("DISPONIBLE")
    expect(body.data[0].fecha_recepcion).toBe("2026-01-01")
  })

  it("VENDEDOR without inventario opt-in — costo_unitario stripped", async () => {
    mockRole("VENDEDOR")
    wire(false)

    const { status, body } = await parseResponse(await getSeries(createGetRequest(), ctx()))

    expect(status).toBe(200)
    expect(body.data[0].costo_unitario).toBeNull()
  })

  it("VENDEDOR with inventario opt-in — costo_unitario visible", async () => {
    mockRole("VENDEDOR")
    wire(true)

    const { status, body } = await parseResponse(await getSeries(createGetRequest(), ctx()))

    expect(status).toBe(200)
    expect(body.data[0].costo_unitario).toBe(250)
  })

  it("the response is not cacheable, since its body varies by role", async () => {
    mockRole("TECNICO")
    wire()

    const res = await getSeries(createGetRequest(), ctx())

    expect(res.headers.get("Cache-Control")).toBe("no-store")
  })
})
