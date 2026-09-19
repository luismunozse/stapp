import { describe, it, expect, beforeEach, vi } from "vitest"
import { GET as getEstadoResultados } from "@/app/api/reportes/estado-resultados/route"
import { supabaseAdmin } from "@/lib/supabase"
import {
  mockAuthSuccess,
  mockSupabaseFrom,
  createChainMock,
  createGetRequest,
  parseResponse,
} from "./helpers"

/** El chain mock con el que se consultó `tabla`. Falla si nunca se consultó. */
function chainDe(tabla: string): any {
  const fromMock = vi.mocked(supabaseAdmin.from)
  const idx = fromMock.mock.calls.findIndex((c) => c[0] === tabla)
  if (idx === -1) throw new Error(`El endpoint no consultó la tabla "${tabla}"`)
  return fromMock.mock.results[idx].value
}

/**
 * Los instantes UTC con los que el endpoint acotó `tabla.columna`.
 * Es la forma de verificar que el período se resolvió en la zona del taller
 * y no con el reloj del proceso.
 */
function rangoConsultado(tabla: string, columna: string): { desde: string; hasta: string } {
  const chain = chainDe(tabla)
  const gte = chain.gte.mock.calls.find((c: any[]) => c[0] === columna)
  const lte = chain.lte.mock.calls.find((c: any[]) => c[0] === columna)
  if (!gte || !lte) throw new Error(`No se acotó ${tabla}.${columna} por rango`)
  return { desde: gte[1], hasta: lte[1] }
}

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
  sesionesCaja?: any[]
  organizations?: any
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
    // Faltantes/sobrantes de arqueo (auditoría contable 1.5). Sin este mock
    // el endpoint corta con error: `traerTodo` propaga los fallos de la base
    // en vez de devolver un reporte a medias.
    sesiones_caja: createChainMock(overrides.sesionesCaja || []),
    // `resolverPeriodo` lee la zona horaria de la org. Sin mock cae al
    // default (Argentina), que es lo que asumen los tests de período.
    organizations: createChainMock(
      overrides.organizations ?? { zona_horaria: "America/Argentina/Buenos_Aires" }
    ),
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

// ─────────────────────────────────────────────────────────────────────────
// Auditoría contable — etapa 1
// ─────────────────────────────────────────────────────────────────────────

describe("estado-resultados · faltantes y sobrantes de caja (1.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("un faltante de arqueo baja la ganancia neta", async () => {
    setupBase({
      ventas: [{ id: "v1", total: 1000 }],
      // diferencia = conteo - esperado. Negativo = falta plata en el cajón.
      sesionesCaja: [{ id: "s1", diferencia: "-2000", closed_at: "2026-05-10T22:00:00Z" }],
    })

    const res = await getEstadoResultados(
      createGetRequest("http://localhost:3000/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31")
    )
    const { body } = await parseResponse(res)

    expect(body.diferenciasCaja.faltantes).toBe(2000)
    expect(body.diferenciasCaja.sobrantes).toBe(0)
    expect(body.diferenciasCaja.neto).toBe(-2000)
    expect(body.diferenciasCaja.cierresConDiferencia).toBe(1)
    // 1000 de ingresos, sin costos ni gastos, menos el faltante
    expect(body.gananciaNeta).toBe(-1000)
  })

  it("faltantes y sobrantes se informan por separado, no compensados", async () => {
    setupBase({
      ventas: [{ id: "v1", total: 10000 }],
      sesionesCaja: [
        { id: "s1", diferencia: "-5000", closed_at: "2026-05-10T22:00:00Z" },
        { id: "s2", diferencia: "5000", closed_at: "2026-05-11T22:00:00Z" },
      ],
    })

    const res = await getEstadoResultados(
      createGetRequest("http://localhost:3000/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31")
    )
    const { body } = await parseResponse(res)

    // Un mes con 5000 de faltante y 5000 de sobrante no es un mes prolijo:
    // el neto da cero pero los dos números tienen que verse.
    expect(body.diferenciasCaja.faltantes).toBe(5000)
    expect(body.diferenciasCaja.sobrantes).toBe(5000)
    expect(body.diferenciasCaja.neto).toBe(0)
    expect(body.diferenciasCaja.cierresConDiferencia).toBe(2)
    expect(body.gananciaNeta).toBe(10000)
  })

  it("los cierres sin diferencia no se cuentan", async () => {
    setupBase({
      sesionesCaja: [{ id: "s1", diferencia: "0", closed_at: "2026-05-10T22:00:00Z" }],
    })

    const res = await getEstadoResultados(
      createGetRequest("http://localhost:3000/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31")
    )
    const { body } = await parseResponse(res)
    expect(body.diferenciasCaja.cierresConDiferencia).toBe(0)
    expect(body.diferenciasCaja.neto).toBe(0)
  })
})

describe("estado-resultados · período en la zona horaria del taller (1.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("mayo de un taller argentino arranca a las 03:00 UTC del 1, no a las 00:00", async () => {
    setupBase()

    await getEstadoResultados(
      createGetRequest("http://localhost:3000/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31")
    )

    expect(rangoConsultado("ventas", "created_at")).toEqual({
      desde: "2026-05-01T03:00:00.000Z",
      hasta: "2026-06-01T02:59:59.999Z",
    })
  })

  it("el mismo período en México usa el offset de México", async () => {
    setupBase({ organizations: { zona_horaria: "America/Mexico_City" } })

    await getEstadoResultados(
      createGetRequest("http://localhost:3000/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31")
    )

    // UTC-6 en mayo
    expect(rangoConsultado("ventas", "created_at")).toEqual({
      desde: "2026-05-01T06:00:00.000Z",
      hasta: "2026-06-01T05:59:59.999Z",
    })
  })

  it("una zona horaria inválida no rompe el reporte: cae al default", async () => {
    setupBase({ organizations: { zona_horaria: "No/Existe" } })

    const res = await getEstadoResultados(
      createGetRequest("http://localhost:3000/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31")
    )
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.periodo.zonaHoraria).toBe("America/Argentina/Buenos_Aires")
  })

  it("el período informado es el mismo que se usó para consultar", async () => {
    setupBase()

    const res = await getEstadoResultados(
      createGetRequest("http://localhost:3000/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31")
    )
    const { body } = await parseResponse(res)
    const usado = rangoConsultado("ventas", "created_at")

    expect(body.periodo.desde).toBe(usado.desde)
    expect(body.periodo.hasta).toBe(usado.hasta)
  })
})

describe("estado-resultados · completitud del reporte (1.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("con pocos datos el reporte no se marca como incompleto", async () => {
    setupBase({ ventas: [{ id: "v1", total: 1000 }] })

    const res = await getEstadoResultados(
      createGetRequest("http://localhost:3000/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31")
    )
    const { body } = await parseResponse(res)
    expect(body.meta.incompleto).toBe(false)
    expect(body.meta.fuentesIncompletas).toEqual([])
  })

  it("las consultas piden páginas explícitas en vez de confiar en el tope por defecto", async () => {
    setupBase({ ventas: [{ id: "v1", total: 1000 }] })

    await getEstadoResultados(
      createGetRequest("http://localhost:3000/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31")
    )

    // El corte silencioso de 1000 filas de PostgREST sólo aplica cuando nadie
    // pide un rango. Pedirlo es lo que convierte "las primeras 1000" en "todas".
    expect(chainDe("ventas").range.mock.calls[0]).toEqual([0, 999])
  })

  it("un error de la base corta el reporte en vez de devolver un total a medias", async () => {
    // Un fallo de red que devuelve media tabla se lee como un mes flojo de
    // ventas. Preferimos el 500 visible.
    setupBase()
    mockSupabaseFrom({
      organizations: createChainMock({ zona_horaria: "America/Argentina/Buenos_Aires" }),
      ventas: createChainMock(null, { message: "connection reset" }),
    })

    const res = await getEstadoResultados(
      createGetRequest("http://localhost:3000/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31")
    )
    expect(res.status).toBe(500)
  })
})
