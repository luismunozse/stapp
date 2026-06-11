import { describe, it, expect, beforeEach, vi } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

import { GET } from "@/app/api/reportes/rentabilidad/route"

describe("GET /api/reportes/rentabilidad labor cost", () => {
  beforeEach(() => vi.clearAllMocks())

  it("subtracts costo_mano_obra from ganancia and reports it", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      ordenes_servicio: createChainMock([
        {
          id: "o1", tipo_dispositivo: "CELULAR", costo_final: "10000",
          porcentaje_comision: "0", tecnico_id: "t1",
          costo_mano_obra: "3000",
          repuestos_orden: [], cotizaciones: [],
        },
      ]),
    })
    const res = await GET()
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    const cel = body.data.find((d: any) => d.tipoDispositivo === "CELULAR")
    expect(cel.costoManoObra).toBe(3000)
    expect(cel.ganancia).toBe(7000)   // 10000 - 0 repuestos - 0 comision - 3000 MO
    expect(cel.costos).toBe(3000)
  })
})
