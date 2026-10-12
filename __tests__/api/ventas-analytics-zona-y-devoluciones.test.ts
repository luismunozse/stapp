import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"

// 2026-10-03 02:00 UTC = 2 de octubre 23:00 en Buenos Aires
const AHORA = new Date("2026-10-03T02:00:00Z")

describe("GET /api/reportes/ventas-analytics — día de la organización y devoluciones", () => {
  let GET: any
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(AHORA)
    GET = (await import("@/app/api/reportes/ventas-analytics/route")).GET
  })
  afterEach(() => vi.useRealTimers())

  function setup(org: Record<string, unknown> = {}) {
    const ventas = [
      // 22:30 del 2/10 en Argentina (01:30 UTC del 3/10): es de HOY para la org
      { id: "v1", total: 1000, estado: "COMPLETADA", metodo_pago: "EFECTIVO", created_at: "2026-10-03T01:30:00Z", descuento: 0, devoluciones_venta: [{ monto_devolucion: 400 }] },
      // 23:00 del 1/10 en Argentina (02:00 UTC del 2/10): ayer
      { id: "v2", total: 500, estado: "COMPLETADA", metodo_pago: "EFECTIVO", created_at: "2026-10-02T02:00:00Z", descuento: 0, devoluciones_venta: [] },
    ]
    mockSupabaseFrom({
      organizations: createChainMock({ zona_horaria: "America/Argentina/Buenos_Aires", vendedores_ven_ingresos: true, ...org }),
      ventas: createChainMock(ventas),
      items_venta: createChainMock([]),
      users: createChainMock([]),
    })
  }

  it("cuenta las ventas en el día de la organización, no en el de UTC", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    setup()
    const { status, body } = await parseResponse(await GET())
    expect(status).toBe(200)
    expect(body.ventasHoy.count).toBe(1)
    const dia = (f: string) => body.ventasPorDia.find((d: any) => d.fecha === f)
    expect(dia("2026-10-02").count).toBe(1)
    expect(dia("2026-10-01").count).toBe(1)
    expect(body.ventasPorDia.at(-1).fecha).toBe("2026-10-02")
  })

  it("los montos son netos de devoluciones", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    setup()
    const { body } = await parseResponse(await GET())
    expect(body.ventasHoy.total).toBe(600) // 1000 − 400 devueltos
    expect(body.ventasMes.total).toBe(1100)
  })

  it("un vendedor de una org que oculta los ingresos recibe 403, como en los demás reportes", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    setup({ vendedores_ven_ingresos: false })
    const res = await GET()
    expect(res.status).toBe(403)
  })
})
