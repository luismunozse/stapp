// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest"
import { mockAuthSuccess, parseResponse } from "./helpers"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"
import { GET as listado } from "@/app/api/comisiones/vendedores/route"
import { GET as ficha } from "@/app/api/vendedores/[id]/route"
import { GET as liquidacion } from "@/app/api/vendedores/[id]/comisiones/route"

const fila = (o: Partial<Record<string, unknown>>) => ({ clave: "VENTA:v1:VENDEDOR:ORIGINAL:-", organization_id: "org-1", sucursal_id: null, documento_tipo: "VENTA", documento_id: "v1", beneficiario_id: "s1", rol: "VENDEDOR", tipo: "ORIGINAL", ajuste_ref: null, base: 1000, porcentaje: 10, monto: 100, fecha_devengo: "2026-10-01T10:00:00Z", devengada: true, pago_id: null, fecha_pago: null, pagado: false, pendiente: 100, documento_codigo: null, documento_numero: 11, documento_detalle: "Cliente Uno", documento_estado: "COMPLETADA", documento_total: 1200, documento_costo_repuestos: null, ...o })

const usuarios = [
  { id: "s1", nombre: "Ana", organization_id: "org-1" },
  { id: "s2", nombre: "Beto", organization_id: "org-1" },
]

const pedirListado = (query = "") => listado(new Request(`http://localhost:3000/api/comisiones/vendedores${query}`))
const pedirLiquidacion = (id: string, query = "") =>
  liquidacion(new Request(`http://localhost:3000/api/vendedores/${id}/comisiones${query}`), { params: Promise.resolve({ id }) })
const pedirFicha = (id: string) => ficha(new Request(`http://localhost:3000/api/vendedores/${id}`), { params: Promise.resolve({ id }) })

const vendedorFicha = { id: "s1", nombre: "Ana", email: "a@a.com", telefono: null, activo: true, porcentaje_comision: 10, created_at: "2026-01-01T00:00:00Z", rol: "VENDEDOR", organization_id: "org-1", deleted_at: null }

describe("seller commission reads use the single definition", () => {
  beforeEach(() => vi.clearAllMocks())

  it("seller tab: a post-payment return row appears negative and nets the pending total", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    montarSupabaseEnMemoria({
      v_comisiones_devengadas: [
        fila({ clave: "VENTA:v1:VENDEDOR:ORIGINAL:-", pagado: true, pago_id: "p1", pendiente: 0, fecha_pago: "2026-10-05T10:00:00Z" }),
        fila({ clave: "VENTA:v1:VENDEDOR:AJUSTE_DEVOLUCION:d1", tipo: "AJUSTE_DEVOLUCION", ajuste_ref: "d1", base: null, porcentaje: null, monto: -30, pendiente: -30, fecha_devengo: "2026-10-08T10:00:00Z" }),
        fila({ clave: "VENTA:v9:VENDEDOR:ORIGINAL:-", documento_id: "v9", organization_id: "org-2", monto: 999, pendiente: 999 }),
      ],
      users: usuarios,
    })

    const { status, body } = await parseResponse(await pedirListado())
    expect(status).toBe(200)
    expect(body.items.map((i: any) => [i.tipo, i.montoComision, i.comisionPagada])).toEqual([
      ["AJUSTE_DEVOLUCION", -30, false],
      ["ORIGINAL", 100, true],
    ])
    expect(body.items[1]).toMatchObject({
      clave: "VENTA:v1:VENDEDOR:ORIGINAL:-",
      ventaId: "v1",
      vendedorId: "s1",
      vendedorNombre: "Ana",
      pagoId: "p1",
      pendiente: 0,
      numeroVenta: 11,
      clienteNombre: "Cliente Uno",
      fecha: "2026-10-01T10:00:00Z",
      total: 1200,
      porcentajeComision: 10,
      fechaPagoComision: "2026-10-05T10:00:00Z",
    })
    expect(body.resumen).toHaveLength(1)
    expect(body.resumen[0]).toMatchObject({ vendedorId: "s1", vendedorNombre: "Ana", totalVentas: 1, totalFacturado: 1200, totalComision: 70, totalPendiente: -30 })
  })

  it("vendedor filter and soloPendientes narrow the list inside the org", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    montarSupabaseEnMemoria({
      v_comisiones_devengadas: [
        fila({ clave: "a" }),
        fila({ clave: "b", beneficiario_id: "s2" }),
        fila({ clave: "c", pagado: true, pago_id: "p1", pendiente: 0 }),
      ],
      users: usuarios,
    })
    const { body } = await parseResponse(await pedirListado("?vendedorId=s1&soloPendientes=true"))
    expect(body.items.map((i: any) => i.clave)).toEqual(["a"])
    const todos = await parseResponse(await pedirListado("?vendedorId=all"))
    expect(todos.body.items).toHaveLength(3)
  })

  it("lists only VENDEDOR rows and looks names up inside the org", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    montarSupabaseEnMemoria({
      v_comisiones_devengadas: [fila({ clave: "a" }), fila({ clave: "t", rol: "TECNICO", documento_tipo: "ORDEN" })],
      users: [{ id: "s1", nombre: "Otra Org", organization_id: "org-2" }],
    })
    const { body } = await parseResponse(await pedirListado())
    expect(body.items.map((i: any) => i.clave)).toEqual(["a"])
    expect(body.items[0].vendedorNombre).toBe("Sin nombre")
  })

  it("500 with the route message when the definition read fails", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    montarSupabaseEnMemoria({ v_comisiones_devengadas: [fila({})], users: usuarios }, { errorDeLectura: { v_comisiones_devengadas: { message: "boom" } } })
    const { status, body } = await parseResponse(await pedirListado())
    expect(status).toBe(500)
    expect(body).toEqual({ error: "Error al obtener comisiones de vendedores" })
  })

  it("vendedor detail: devengada - pagada === pendiente over every row", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    montarSupabaseEnMemoria({
      users: [vendedorFicha],
      ventas: [],
      v_comisiones_devengadas: [
        fila({ clave: "a", pagado: true, pago_id: "p1", pendiente: 0, monto: 100.1 }),
        fila({ clave: "b", monto: 50.2, pendiente: 50.2 }),
        fila({ clave: "c", tipo: "AJUSTE_DEVOLUCION", monto: -30.05, pendiente: -30.05 }),
        fila({ clave: "x", beneficiario_id: "s2", monto: 700, pendiente: 700 }),
        fila({ clave: "y", organization_id: "org-2", monto: 800, pendiente: 800 }),
        fila({ clave: "t", rol: "TECNICO", monto: 900, pendiente: 900 }),
      ],
    }, { resultadoRpc: () => [] })

    const { status, body } = await parseResponse(await pedirFicha("s1"))
    expect(status).toBe(200)
    expect(body.comisionDevengada).toBe(120.25)
    expect(body.comisionPagada).toBe(100.1)
    expect(body.comisionPendiente).toBe(20.15)
    expect(Math.round((body.comisionDevengada - body.comisionPagada) * 100) / 100).toBe(body.comisionPendiente)
  })

  it("vendedor detail: counts the payable pending rows even when they net to zero, ignoring zero-amount rows", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    montarSupabaseEnMemoria({
      users: [vendedorFicha],
      ventas: [],
      v_comisiones_devengadas: [
        fila({ clave: "a", monto: 50, pendiente: 50 }),
        fila({ clave: "b", tipo: "AJUSTE_DEVOLUCION", monto: -50, pendiente: -50 }),
        fila({ clave: "z", monto: 0, pendiente: 0 }),
        fila({ clave: "p", pagado: true, pago_id: "p1", pendiente: 0, monto: 70 }),
      ],
    }, { resultadoRpc: () => [] })
    const { body } = await parseResponse(await pedirFicha("s1"))
    expect(body.comisionPendiente).toBe(0)
    expect(body.filasPendientes).toBe(2)
  })

  it("liquidation list: estado=pendiente returns only unpaid rows of that seller in that org", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    montarSupabaseEnMemoria({
      v_comisiones_devengadas: [
        fila({ clave: "mine-unpaid", fecha_devengo: "2026-10-03T10:00:00Z" }),
        fila({ clave: "mine-paid", pagado: true, pago_id: "p1", pendiente: 0, fecha_pago: "2026-10-04T10:00:00Z", fecha_devengo: "2026-10-02T10:00:00Z" }),
        fila({ clave: "v2-unpaid", beneficiario_id: "s2" }),
        fila({ clave: "other-org", organization_id: "org-2" }),
      ],
    })

    const { status, body } = await parseResponse(await pedirLiquidacion("s1", "?estado=pendiente"))
    expect(status).toBe(200)
    expect(body.comisiones.map((c: any) => c.clave)).toEqual(["mine-unpaid"])
    expect(body.comisiones[0]).toEqual({
      clave: "mine-unpaid",
      ventaId: "v1",
      tipo: "ORIGINAL",
      pagoId: null,
      numeroVenta: 11,
      clienteNombre: "Cliente Uno",
      fecha: "2026-10-03T10:00:00Z",
      total: 1200,
      porcentajeComision: 10,
      montoComision: 100,
      pagada: false,
      fechaPago: null,
    })
    expect(body.totales).toEqual({ devengada: 100, pagada: 0, pendiente: 100 })

    const pagadas = await parseResponse(await pedirLiquidacion("s1", "?estado=pagada"))
    expect(pagadas.body.comisiones.map((c: any) => c.clave)).toEqual(["mine-paid"])
    expect(pagadas.body.totales).toEqual({ devengada: 100, pagada: 100, pendiente: 0 })

    const todas = await parseResponse(await pedirLiquidacion("s1"))
    expect(todas.body.comisiones).toHaveLength(2)
  })

  it("none of the three routes reads v_comisiones_ventas", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const mem = montarSupabaseEnMemoria({ users: [vendedorFicha], ventas: [], v_comisiones_devengadas: [fila({})] }, { resultadoRpc: () => [] })
    await pedirListado()
    await pedirFicha("s1")
    await pedirLiquidacion("s1")
    expect(mem.lecturas).toContain("v_comisiones_devengadas")
    expect(mem.lecturas).not.toContain("v_comisiones_ventas")
  })
})
