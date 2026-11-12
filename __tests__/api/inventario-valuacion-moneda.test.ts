import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { cargarConfigMoneda, resolverTipoCambio } from "@/lib/currency/tipo-cambio.server"
import { resolverConfigMoneda } from "@/lib/currency/config-moneda"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createGetRequest, parseResponse } from "./helpers"

// Valuación de stock con ítems en divisa: se suma en local, la cotización se resuelve una sola
// vez y solo si algún ítem está en divisa.

vi.mock("@/lib/currency/tipo-cambio.server", () => ({
  cargarConfigMoneda: vi.fn(),
  resolverTipoCambio: vi.fn(),
}))

import { GET as getStats } from "@/app/api/inventario/stats/route"
import { GET as getSummary } from "@/app/api/inventario/summary/route"
import { GET as getAnalytics } from "@/app/api/reportes/inventario-analytics/route"
import { GET as getAnalisis } from "@/app/api/reportes/analisis-inventario/route"
import { GET as getAbc } from "@/app/api/inventario/analisis-abc/route"

const configUsd = {
  config: {
    ...resolverConfigMoneda({ multimoneda_habilitada: true, moneda_extranjera: "USD" } as any, "AR"),
    habilitada: true,
    redondeoConversion: 10,
  },
  fila: null,
}
const tcOk = { disponible: true, valor: 1200, fuente: "MANUAL", estado: "manual" } as any
const tcNo = { disponible: false, motivo: "sin_cotizacion" } as any

const local = { id: "a", codigo: "A", nombre: "A", categoria: "X", stock: 2, stock_minimo: 1, precio_compra: 500, precio_venta: 800, moneda: null }
const usd = { id: "b", codigo: "B", nombre: "B", categoria: "X", stock: 1, stock_minimo: 1, precio_compra: 10, precio_venta: 20, moneda: "USD" }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(cargarConfigMoneda).mockResolvedValue(configUsd as any)
  vi.mocked(resolverTipoCambio).mockResolvedValue(tcOk)
  mockAuthSuccess({ role: "ADMIN" })
})

const wireInv = (items: unknown[]) =>
  mockSupabaseFrom({
    inventario: createChainMock(items),
    organizations: createChainMock({ umbral_stock_bajo: 5 }),
    movimientos_inventario: createChainMock([]),
  })

describe("GET /api/inventario/stats", () => {
  it("suma en local: 2 x 500 + 1 x USD 10 a 1200 = 13000, aproximado", async () => {
    wireInv([local, usd])
    const { body } = await parseResponse(await getStats())
    expect(body.valorCosto).toBe(13000)
    expect(body.valorVenta).toBe(1600 + 24000)
    expect(body.aproximado).toBe(true)
    expect(body.excluidosSinCotizacion).toBe(0)
  })

  it("sin cotización excluye el ítem en divisa y lo cuenta", async () => {
    vi.mocked(resolverTipoCambio).mockResolvedValue(tcNo)
    wireInv([local, usd])
    const { body } = await parseResponse(await getStats())
    expect(body.valorCosto).toBe(1000)
    expect(body.excluidosSinCotizacion).toBe(1)
  })

  it("sin ítems en divisa no resuelve cotización y no es aproximado", async () => {
    wireInv([local])
    const { body } = await parseResponse(await getStats())
    expect(body.valorCosto).toBe(1000)
    expect(body.aproximado).toBe(false)
    expect(body.excluidosSinCotizacion).toBe(0)
    expect(resolverTipoCambio).not.toHaveBeenCalled()
    expect(cargarConfigMoneda).not.toHaveBeenCalled()
  })

  it("un rol sin acceso a costo sigue sin recibir cifras de costo", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    mockSupabaseFrom({
      inventario: createChainMock([local, usd]),
      organizations: createChainMock({ umbral_stock_bajo: 5, vendedores_administran_inventario: false }),
    })
    const { body } = await parseResponse(await getStats())
    expect(body.valorCosto).toBeNull()
    expect(body.valorEnRiesgo).toBeNull()
    expect(body.valorVenta).toBe(25600)
  })
})

describe("GET /api/inventario/summary", () => {
  it("suma costo, venta y margen en local", async () => {
    wireInv([local, usd])
    const { body } = await parseResponse(await getSummary(createGetRequest()))
    expect(body.valorCosto).toBe(13000)
    expect(body.valorVenta).toBe(25600)
    expect(body.margenEstimado).toBe(12600)
    expect(body.aproximado).toBe(true)
  })

  it("sin cotización: excluye y cuenta", async () => {
    vi.mocked(resolverTipoCambio).mockResolvedValue(tcNo)
    wireInv([local, usd])
    const { body } = await parseResponse(await getSummary(createGetRequest()))
    expect(body.valorCosto).toBe(1000)
    expect(body.excluidosSinCotizacion).toBe(1)
  })

  it("sin divisa no resuelve cotización", async () => {
    wireInv([local])
    const { body } = await parseResponse(await getSummary(createGetRequest()))
    expect(body.aproximado).toBe(false)
    expect(resolverTipoCambio).not.toHaveBeenCalled()
  })
})

describe("reportes de inventario", () => {
  it("inventario-analytics: valorización y por categoría en local", async () => {
    wireInv([local, usd])
    const { body } = await parseResponse(await getAnalytics())
    expect(body.valorizacion.valorCosto).toBe(13000)
    expect(body.valorizacion.valorVenta).toBe(25600)
    expect(body.valorizacion.aproximado).toBe(true)
    expect(body.porCategoria[0].valorCosto).toBe(13000)
  })

  it("inventario-analytics sin divisa: no resuelve cotización", async () => {
    wireInv([local])
    const { body } = await parseResponse(await getAnalytics())
    expect(body.valorizacion.aproximado).toBe(false)
    expect(resolverTipoCambio).not.toHaveBeenCalled()
  })

  it("analisis-inventario: resumen en local y excluidos sin cotización", async () => {
    wireInv([
      { ...local, precio_compra: 500, precio_venta: 800 },
      { ...usd, categoria: "X" },
    ])
    const ok = await parseResponse(await getAnalisis())
    expect(ok.body.resumen.valorCompra).toBe(13000)
    expect(ok.body.resumen.aproximado).toBe(true)

    vi.mocked(resolverTipoCambio).mockResolvedValue(tcNo)
    const no = await parseResponse(await getAnalisis())
    expect(no.body.resumen.valorCompra).toBe(1000)
    expect(no.body.resumen.excluidosSinCotizacion).toBe(1)
  })
})

describe("GET /api/inventario/analisis-abc", () => {
  const rpcRow = (id: string, extra: Record<string, unknown> = {}) => ({
    inventario_id: id, codigo: id, nombre: id, categoria: "X", tipo_dispositivo: "CELULAR",
    proveedor_id: null, proveedor_nombre: null, stock_actual: 1,
    // la función SQL usa el precio crudo
    precio_compra: 10, precio_venta: 20, capital_inmovilizado: 10,
    qty_vendida: 3, revenue: 72000, margen_unitario: 10, margen_total: 30,
    ventas_count: 1, ultima_venta_at: null, dias_sin_venta: 0, rotacion: 1,
    dias_promedio_stock: 5, pct_revenue: 100, pct_revenue_acumulado: 100,
    clasificacion_abc: "A", clasificacion_rotacion: "MUERTA", ...extra,
  })
  const wire = () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: [rpcRow("b"), rpcRow("a", { precio_compra: 500, precio_venta: 800, capital_inmovilizado: 500, margen_unitario: 300, margen_total: 900 })],
      error: null,
    } as any)
    mockSupabaseFrom({
      inventario: createChainMock([
        { id: "b", moneda: "USD", precio_compra: 10, precio_venta: 20 },
      ]),
    })
  }

  it("recalcula capital y margen del ítem en divisa en local", async () => {
    wire()
    const { body } = await parseResponse(await getAbc(createGetRequest()))
    const b = body.data.find((r: any) => r.inventarioId === "b")
    expect(b.capitalInmovilizado).toBe(12000)
    expect(b.precioCompra).toBe(12000)
    expect(b.margenUnitario).toBe(12000)
    expect(b.margenTotal).toBe(36000)
    const a = body.data.find((r: any) => r.inventarioId === "a")
    expect(a.capitalInmovilizado).toBe(500)
    expect(body.totales.capitalInmovilizado).toBe(12500)
    expect(body.totales.capitalMuerto).toBe(12500)
    expect(body.aproximado).toBe(true)
    expect(body.excluidosSinCotizacion).toBe(0)
  })

  it("sin cotización excluye la fila en divisa y la cuenta", async () => {
    vi.mocked(resolverTipoCambio).mockResolvedValue(tcNo)
    wire()
    const { body } = await parseResponse(await getAbc(createGetRequest()))
    expect(body.data).toHaveLength(1)
    expect(body.totales.capitalInmovilizado).toBe(500)
    expect(body.excluidosSinCotizacion).toBe(1)
  })

  it("sin ítems en divisa no resuelve cotización", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: [rpcRow("a")], error: null } as any)
    mockSupabaseFrom({ inventario: createChainMock([]) })
    const { body } = await parseResponse(await getAbc(createGetRequest()))
    expect(body.aproximado).toBe(false)
    expect(resolverTipoCambio).not.toHaveBeenCalled()
  })
})
