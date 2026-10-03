import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, createGetRequest, parseResponse } from "./helpers"

describe("GET /api/reportes/resumen-ingresos — ventas por pagos reales y meses de la organización", () => {
  let GET: any
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.useFakeTimers({ toFake: ["Date"] })
    // 1 de noviembre 01:00 UTC = 31 de octubre 22:00 en Buenos Aires
    vi.setSystemTime(new Date("2026-11-01T01:00:00Z"))
    GET = (await import("@/app/api/reportes/resumen-ingresos/route")).GET
  })
  afterEach(() => vi.useRealTimers())

  function setup(ventas: any[]) {
    mockSupabaseFrom({
      organizations: createChainMock({ zona_horaria: "America/Argentina/Buenos_Aires" }),
      facturas: createChainMock([]),
      cobros_orden: createChainMock([]),
      ventas: createChainMock(ventas),
    })
  }

  it("una venta mitad efectivo y mitad tarjeta se reparte; lo no cobrado queda pendiente", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    setup([
      {
        id: "v1", total: 1000, iva_neto: null, metodo_pago: "EFECTIVO", created_at: "2026-10-15T15:00:00Z",
        pagos_venta: [
          { monto: 400, metodo_pago: "EFECTIVO" },
          { monto: 400, metodo_pago: "TARJETA_DEBITO" },
        ],
      },
    ])

    const { body } = await parseResponse(await GET(createGetRequest("http://localhost/api/reportes/resumen-ingresos?meses=2")))
    const octubre = body.porMetodoPago.find((m: any) => m.mesKey === "2026-10")
    const por = Object.fromEntries(octubre.metodos.map((m: any) => [m.metodo, m.monto]))
    expect(por).toEqual({ EFECTIVO: 400, TARJETA_DEBITO: 400, PENDIENTE_COBRO: 200 })
  })

  it("una venta de la noche del 31 de octubre en Argentina es de octubre, no de noviembre", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    setup([
      { id: "v2", total: 500, iva_neto: null, metodo_pago: "EFECTIVO", created_at: "2026-11-01T00:30:00Z", pagos_venta: [{ monto: 500, metodo_pago: "EFECTIVO" }] },
    ])

    const { body } = await parseResponse(await GET(createGetRequest("http://localhost/api/reportes/resumen-ingresos?meses=2")))
    const octubre = body.porMetodoPago.find((m: any) => m.mesKey === "2026-10")
    expect(octubre.total).toBe(500)
    expect(body.porMetodoPago.find((m: any) => m.mesKey === "2026-11")).toBeUndefined()
  })
})
