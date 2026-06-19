import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
} from "./helpers"

vi.mock("@/lib/sucursal", () => ({
  sucursalParaLectura: vi.fn().mockResolvedValue({ verTodas: true, sucursalId: null }),
}))

vi.mock("@/lib/db-utils", () => ({
  formatOrden: (o: any) => o,
}))

import { GET } from "@/app/api/ordenes/route"

describe("GET /api/ordenes — filtro fecha_entrega", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("filtra fecha_entrega >= cuando se pasa fechaEntregaDesde", async () => {
    mockAuthSuccess()
    const chain = createChainMock([], null, 0)
    mockSupabaseFrom({ ordenes_servicio: chain })

    await GET(
      createGetRequest("http://localhost:3000/api/ordenes?fechaEntregaDesde=2026-06-01")
    )

    expect(chain.gte).toHaveBeenCalledWith("fecha_entrega", "2026-06-01T00:00:00")
  })

  it("filtra fecha_entrega <= cuando se pasa fechaEntregaHasta", async () => {
    mockAuthSuccess()
    const chain = createChainMock([], null, 0)
    mockSupabaseFrom({ ordenes_servicio: chain })

    await GET(
      createGetRequest("http://localhost:3000/api/ordenes?fechaEntregaHasta=2026-06-30")
    )

    expect(chain.lte).toHaveBeenCalledWith("fecha_entrega", "2026-06-30T23:59:59")
  })

  it("no filtra por fecha_entrega cuando no se pasan los params", async () => {
    mockAuthSuccess()
    const chain = createChainMock([], null, 0)
    mockSupabaseFrom({ ordenes_servicio: chain })

    await GET(createGetRequest("http://localhost:3000/api/ordenes"))

    const gteEntrega = chain.gte.mock.calls.some((c) => c[0] === "fecha_entrega")
    const lteEntrega = chain.lte.mock.calls.some((c) => c[0] === "fecha_entrega")
    expect(gteEntrega).toBe(false)
    expect(lteEntrega).toBe(false)
  })
})
