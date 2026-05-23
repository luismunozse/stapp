import { describe, it, expect, beforeEach, vi } from "vitest"
import { GET as getEstadoResultados } from "@/app/api/reportes/estado-resultados/route"
import {
  mockAuthSuccess,
  mockSupabaseFrom,
  createChainMock,
  createGetRequest,
  parseResponse,
} from "./helpers"

// Tests fundamentales del modelo híbrido devengado + adelantos + NC + merma.
// No corre contra DB real — verifica lógica del endpoint con mocks.

function setupBase(overrides: {
  ventas?: any[]
  ordenes?: any[]
  cobrosPreviosTerm?: any[]
  cobrosPeriodo?: any[]
  movIngresos?: any[]
  movEgresos?: any[]
  pagosVentaCF?: any[]
  pagosParcialCF?: any[]
  cobrosCF?: any[]
  notasCredito?: any[]
  ajustes?: any[]
} = {}) {
  const venta = (extras: any = {}) => ({
    id: extras.id || "v1",
    total: 0,
    estado: "COMPLETADA",
    created_at: "2026-05-10T10:00:00Z",
    porcentaje_comision: null,
    vendedor_id: null,
    items_venta: [],
    ...extras,
  })
  const orden = (extras: any = {}) => ({
    id: extras.id || "o1",
    costo_final: "0",
    fecha_completado: "2026-05-15T10:00:00Z",
    estado: "ENTREGADO",
    porcentaje_comision: null,
    tecnico_id: null,
    repuestos_orden: [],
    cotizaciones: [],
    ...extras,
  })

  mockSupabaseFrom({
    ventas: createChainMock((overrides.ventas || []).map(venta)),
    ordenes_servicio: createChainMock((overrides.ordenes || []).map(orden)),
    cobros_orden: createChainMock([]), // patched per-call below
    movimientos_caja: createChainMock([]),
    pagos_venta: createChainMock(overrides.pagosVentaCF || []),
    pagos_parciales: createChainMock(overrides.pagosParcialCF || []),
    facturas: createChainMock([]),
    notas_credito: createChainMock(overrides.notasCredito || []),
    ajustes_inventario: createChainMock(overrides.ajustes || []),
  })
}

describe("estado-resultados", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("ENTREGADO_SIN_COBRO con repuestos: ingreso 0, costo cuenta", async () => {
    // En el primer test verificamos shape básico — los mocks chainables
    // hacen que cobros previos y otros queries sigan resolviendo con [].
    setupBase({
      ordenes: [{
        id: "o1",
        estado: "ENTREGADO_SIN_COBRO",
        costo_final: "500",
        repuestos_orden: [{ cantidad: 2, precio_unitario: "100" }],
      }],
    })

    const desde = "2026-05-01"
    const hasta = "2026-05-31"
    const res = await getEstadoResultados(
      createGetRequest(`http://localhost:3000/api/reportes/estado-resultados?desde=${desde}&hasta=${hasta}`)
    )
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.ingresos.servicios).toBe(0)
    expect(body.costos.repuestos).toBe(200) // 2 * 100
  })

  it("Comisión técnico devenga sobre ganancia (costo_final - repuestos)", async () => {
    setupBase({
      ordenes: [{
        id: "o1",
        estado: "REPARADO",
        costo_final: "1000",
        tecnico_id: "tec1",
        porcentaje_comision: "10",
        repuestos_orden: [{ cantidad: 1, precio_unitario: "300" }],
      }],
    })

    const res = await getEstadoResultados(
      createGetRequest("http://localhost:3000/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31")
    )
    const { body } = await parseResponse(res)
    // ganancia = 1000 - 300 = 700; comisión 10% = 70
    expect(body.comisiones.tecnicos).toBe(70)
  })

  it("Ventas COMPLETADA con vendedor: comisión vendedor sobre total", async () => {
    setupBase({
      ventas: [{
        id: "v1",
        total: 1000,
        vendedor_id: "vend1",
        porcentaje_comision: "5",
      }],
    })

    const res = await getEstadoResultados(
      createGetRequest("http://localhost:3000/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31")
    )
    const { body } = await parseResponse(res)
    expect(body.comisiones.vendedores).toBe(50)
  })

  it("Nota crédito sobre venta: resta del ingreso de ventas", async () => {
    setupBase({
      ventas: [{ id: "v1", total: 1000 }],
      notasCredito: [{ monto: "200", venta_id: "v1", orden_id: null }],
    })

    const res = await getEstadoResultados(
      createGetRequest("http://localhost:3000/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31")
    )
    const { body } = await parseResponse(res)
    expect(body.ingresos.ventasBruto).toBe(1000)
    expect(body.ingresos.ventas).toBe(800)
    expect(body.notasCredito.ventas).toBe(200)
  })

  it("Merma con afecta_rentabilidad=true cuenta como costo", async () => {
    setupBase({
      ajustes: [
        { tipo: "MERMA", cantidad: 3, costo_unitario_snapshot: "50", afecta_rentabilidad: true },
        { tipo: "ROBO", cantidad: 1, costo_unitario_snapshot: "200", afecta_rentabilidad: false }, // excluida
      ],
    })

    const res = await getEstadoResultados(
      createGetRequest("http://localhost:3000/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31")
    )
    const { body } = await parseResponse(res)
    expect(body.costos.merma).toBe(150) // 3 * 50, ROBO excluido por afecta_rentabilidad=false
  })

  it("Cotización ACEPTADA con costo_unitario snapshot suma costo de repuestos", async () => {
    setupBase({
      ordenes: [{
        id: "o1",
        estado: "REPARADO",
        costo_final: "500",
        cotizaciones: [{
          estado: "ACEPTADA",
          deleted_at: null,
          items_cotizacion: [
            { cantidad: 2, costo_unitario: "50", inventario: null },
            { cantidad: 1, costo_unitario: null, inventario: { precio_compra: "30" } }, // fallback
          ],
        }],
      }],
    })

    const res = await getEstadoResultados(
      createGetRequest("http://localhost:3000/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31")
    )
    const { body } = await parseResponse(res)
    expect(body.costos.repuestos).toBe(130) // 2*50 + 1*30
  })
})
