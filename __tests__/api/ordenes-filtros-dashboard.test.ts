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

const ESTADOS_ACTIVOS = ["RECIBIDO", "EN_DIAGNOSTICO", "PRESUPUESTADO", "APROBADO", "EN_REPARACION", "ESPERANDO_REPUESTO"]

describe("GET /api/ordenes — grupos del dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("activas=true filtra las órdenes en curso (tarjeta 'Órdenes pendientes')", async () => {
    mockAuthSuccess()
    const chain = createChainMock([], null, 0)
    mockSupabaseFrom({ ordenes_servicio: chain })

    await GET(createGetRequest("http://localhost:3000/api/ordenes?activas=true"))

    expect(chain.in).toHaveBeenCalledWith("estado", ESTADOS_ACTIVOS)
  })

  it("cobroPendiente=true usa la misma definición que 'Cobros pendientes'", async () => {
    mockAuthSuccess()
    const chain = createChainMock([], null, 0)
    mockSupabaseFrom({ ordenes_servicio: chain })

    await GET(createGetRequest("http://localhost:3000/api/ordenes?cobroPendiente=true"))

    expect(chain.in).toHaveBeenCalledWith("estado_cobro", ["PENDIENTE", "PARCIAL"])
    expect(chain.in).toHaveBeenCalledWith("estado", ["REPARADO", "ENTREGADO", "ENTREGADO_SIN_REPARACION"])
    expect(chain.gt).toHaveBeenCalledWith("costo_final", 0)
  })

  it("sin los params no agrega esos filtros", async () => {
    mockAuthSuccess()
    const chain = createChainMock([], null, 0)
    mockSupabaseFrom({ ordenes_servicio: chain })

    await GET(createGetRequest("http://localhost:3000/api/ordenes"))

    expect(chain.in.mock.calls.some((c) => c[0] === "estado" || c[0] === "estado_cobro")).toBe(false)
    expect(chain.gt.mock.calls.some((c) => c[0] === "costo_final")).toBe(false)
  })
})
