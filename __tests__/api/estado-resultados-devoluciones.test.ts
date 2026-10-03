import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse, createGetRequest } from "./helpers"
import { cookies } from "next/headers"

function mockCookie(value: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) => (name === "stapp-sucursal-activa" && value ? { value } : undefined)),
    set: vi.fn(),
  } as any)
}

const url = "http://localhost/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31"

describe("estado-resultados — devoluciones de ventas", () => {
  let GET: any
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    GET = (await import("@/app/api/reportes/estado-resultados/route")).GET
  })

  function setup(devoluciones: any[]) {
    const devolucionesChain = createChainMock(devoluciones)
    mockSupabaseFrom({
      ventas: createChainMock([
        {
          id: "v1", total: "1000", iva_neto: null, estado: "COMPLETADA",
          vendedor_id: "u1", porcentaje_comision: "10", comision_pagada: false,
          items_venta: [{ cantidad: 2, precio_unitario: "500", costo_unitario_snapshot: "300" }],
          devoluciones_venta: [{ monto_devolucion: "500" }],
        },
      ]),
      devoluciones_venta: devolucionesChain,
      ordenes_servicio: createChainMock([]),
      cobros_orden: createChainMock([]),
      movimientos_caja: createChainMock([]),
      pagos_venta: createChainMock([]),
      pagos_parciales: createChainMock([]),
      facturas: createChainMock([]),
      notas_credito: createChainMock([]),
      ajustes_inventario: createChainMock([]),
      organizations: createChainMock({ comision_aplica_sin_reparacion: false }),
    })
    return devolucionesChain
  }

  it("resta lo devuelto de las ventas, el costo de lo que volvió al stock y la comisión", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")
    setup([
      {
        monto_devolucion: "500",
        items_devolucion: [{ cantidad: 1, restaurar_stock: true, items_venta: { costo_unitario_snapshot: "300" } }],
      },
    ])

    const { status, body } = await parseResponse(await GET(createGetRequest(url)))

    expect(status).toBe(200)
    expect(body.ingresos.ventas).toBe(500) // 1000 − 500 devueltos
    expect(body.devoluciones).toEqual({ ventas: 500, costoDevueltoAStock: 300 })
    expect(body.costos.productos).toBe(300) // 600 vendidos − 300 que volvieron
    expect(body.comisiones.vendedores).toBe(50) // 10% de lo que quedó vendido
  })

  it("lo devuelto sin reponer stock (roto) sigue siendo costo", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")
    setup([
      {
        monto_devolucion: "500",
        items_devolucion: [{ cantidad: 1, restaurar_stock: false, items_venta: { costo_unitario_snapshot: "300" } }],
      },
    ])

    const { body } = await parseResponse(await GET(createGetRequest(url)))
    expect(body.costos.productos).toBe(600)
  })

  it("con una sucursal elegida filtra las devoluciones por la sucursal de la venta", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")
    const chain = setup([])

    await GET(createGetRequest(url))

    expect(chain.eq).toHaveBeenCalledWith("ventas.sucursal_id", "suc-A")
    expect(chain.eq).toHaveBeenCalledWith("ventas.estado", "COMPLETADA")
  })
})
