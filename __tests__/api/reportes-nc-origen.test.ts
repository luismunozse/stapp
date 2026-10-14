import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse, createGetRequest } from "./helpers"
import { cookies } from "next/headers"

// Una NC resta ingreso solo si su orden puede devengar. En los reportes de
// devengado una orden CANCELADO / SIN_REPARACION / SIN_FALLA_DETECTADA nunca
// sumó ingreso: restar su NC la contaba dos veces. En los de caja el cobro de
// esa orden sí sigue sumando, así que su NC tiene que seguir restando.

function mockCookie(value: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) => (name === "stapp-sucursal-activa" && value ? { value } : undefined)),
    set: vi.fn(),
  } as any)
}

const ahora = new Date()
const mesActual = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}`
const fechaEnMes = `${mesActual}-10T12:00:00Z`

function ncSobreOrden(estado: string, monto = "300") {
  return { monto, fecha: fechaEnMes, venta_id: null, orden_id: `o-${estado}`, ordenes_servicio: { estado } }
}

// Cobro adelantado de una orden en curso: suma 1000 de ingreso de servicios.
const adelanto = {
  orden_id: "o-en-curso",
  monto: "1000",
  created_at: fechaEnMes,
  costo_financiero_monto: null,
  ordenes_servicio: { estado: "EN_REPARACION", fecha_completado: null, organization_id: "org-1", sucursal_id: "suc-A" },
}

function tablas(notasCredito: any[], extra: Record<string, any> = {}) {
  const nc = createChainMock(notasCredito)
  mockSupabaseFrom({
    ventas: createChainMock([]),
    ordenes_servicio: createChainMock([]),
    cobros_orden: createChainMock([]),
    movimientos_caja: createChainMock([]),
    pagos_venta: createChainMock([]),
    pagos_parciales: createChainMock([]),
    facturas: createChainMock([]),
    devoluciones_venta: createChainMock([]),
    notas_credito: nc,
    ajustes_inventario: createChainMock([]),
    organizations: createChainMock({ comision_aplica_sin_reparacion: false, zona_horaria: "America/Argentina/Buenos_Aires" }),
    ...extra,
  })
  return nc
}

describe("estado-resultados — NC según el estado de la orden", () => {
  let GET: any
  const url = `http://localhost/api/reportes/estado-resultados?desde=${mesActual}-01&hasta=${mesActual}-28`

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    GET = (await import("@/app/api/reportes/estado-resultados/route")).GET
  })

  it.each(["CANCELADO", "SIN_REPARACION", "SIN_FALLA_DETECTADA"])(
    "no resta una NC sobre una orden %s (esa orden nunca sumó ingreso)",
    async (estado) => {
      mockAuthSuccess({ role: "ADMIN" })
      mockCookie("todas")
      const nc = tablas([ncSobreOrden(estado)])

      const { body } = await parseResponse(await GET(createGetRequest(url)))

      expect(body.notasCredito.servicios).toBe(0)
      expect(nc.select).toHaveBeenCalledWith(expect.stringContaining("ordenes_servicio(estado)"))
    }
  )

  it("resta una NC sobre una orden entregada", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")
    tablas([ncSobreOrden("ENTREGADO")])

    const { body } = await parseResponse(await GET(createGetRequest(url)))

    expect(body.notasCredito.servicios).toBe(300)
  })
})

describe("tendencia-financiera — NC según el estado de la orden", () => {
  let GET: any
  const url = "http://localhost/api/reportes/tendencia-financiera?meses=3"

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    GET = (await import("@/app/api/reportes/tendencia-financiera/route")).GET
  })

  it("no resta una NC sobre una orden CANCELADA", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")
    const nc = tablas([ncSobreOrden("CANCELADO")], { cobros_orden: createChainMock([adelanto]) })

    const { body } = await parseResponse(await GET(createGetRequest(url)))

    expect(body.totales.ingresos).toBe(1000)
    expect(nc.select).toHaveBeenCalledWith(expect.stringContaining("ordenes_servicio(estado)"))
  })

  it("resta una NC sobre una orden en curso", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")
    tablas([ncSobreOrden("EN_REPARACION")], { cobros_orden: createChainMock([adelanto]) })

    const { body } = await parseResponse(await GET(createGetRequest(url)))

    expect(body.totales.ingresos).toBe(700)
  })
})

describe("reportes de caja — la NC resta aunque la orden esté cancelada", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it("comparativa-ingresos: el cobro de la orden cancelada sigue sumando, así que su NC resta", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")
    tablas([{ monto: "300" }], {
      cobros_orden: createChainMock([{ id: "c1", monto: "1000", orden_id: "o-CANCELADO" }]),
    })
    const { GET } = await import("@/app/api/reportes/comparativa-ingresos/route")

    const { body } = await parseResponse(await GET())

    expect(body.mesActual.totalNotasCredito).toBe(300)
    expect(body.mesActual.total).toBe(700)
  })
})
