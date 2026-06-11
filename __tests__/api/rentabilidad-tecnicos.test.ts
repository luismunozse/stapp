import { describe, it, expect, beforeEach, vi } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn(),
}))

import { hasPlanFeature } from "@/lib/subscriptions"
import { GET } from "@/app/api/reportes/rentabilidad-tecnicos/route"

function req(qs = "") {
  return new Request(`http://localhost:3000/api/reportes/rentabilidad-tecnicos${qs}`)
}

describe("GET /api/reportes/rentabilidad-tecnicos", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 403 without advanced_reports", async () => {
    mockAuthSuccess()
    vi.mocked(hasPlanFeature).mockResolvedValue(false)
    const res = await GET(req())
    const { status, body } = await parseResponse(res)
    expect(status).toBe(403)
    expect(body.feature).toBe("advanced_reports")
  })

  it("returns 400 when desde > hasta", async () => {
    mockAuthSuccess()
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    const res = await GET(req("?desde=2026-06-10&hasta=2026-06-01"))
    const { status } = await parseResponse(res)
    expect(status).toBe(400)
  })

  it("aggregates revenue, costs, hours and profit per technician", async () => {
    mockAuthSuccess()
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    mockSupabaseFrom({
      ordenes_servicio: createChainMock([
        {
          id: "o1", tecnico_id: "t1", costo_final: "10000",
          porcentaje_comision: "10", horas_trabajadas: "2", costo_mano_obra: "3000",
          tecnico: { nombre: "Ana" },
          repuestos_orden: [{ cantidad: 1, precio_unitario: "1000" }],
          cotizaciones: [],
        },
        {
          id: "o2", tecnico_id: "t1", costo_final: "5000",
          porcentaje_comision: "0", horas_trabajadas: "1", costo_mano_obra: "0",
          tecnico: { nombre: "Ana" },
          repuestos_orden: [], cotizaciones: [],
        },
      ]),
    })
    const res = await GET(req("?desde=2026-06-01&hasta=2026-06-30"))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    const ana = body.data.find((d: any) => d.tecnicoId === "t1")
    expect(ana.ordenes).toBe(2)
    expect(ana.horasTrabajadas).toBe(3)
    expect(ana.ingresos).toBe(15000)
    expect(ana.costoRepuestos).toBe(1000)
    expect(ana.costoManoObra).toBe(3000)
    expect(ana.comision).toBe(900)
    expect(ana.ganancia).toBe(10100)
    expect(ana.gananciaPorHora).toBe(Math.round((10100 / 3) * 100) / 100)
  })
})
