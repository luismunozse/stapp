/**
 * PATCH /api/caja/movimientos/metodo-pago — corregir el medio de pago de un
 * movimiento de caja sobre su registro original.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  parseResponse,
} from "./helpers"

import { PATCH } from "@/app/api/caja/movimientos/metodo-pago/route"

const URL = "http://localhost:3000/api/caja/movimientos/metodo-pago"

function patch(body: unknown): Request {
  return new Request(URL, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function pagoVentaChain(row: any, updateSpy?: ReturnType<typeof vi.fn>) {
  const chain = createChainMock(row, null)
  if (updateSpy) chain.update = updateSpy
  return chain
}

const pagoVenta = {
  id: "pv-1",
  metodo_pago: "TARJETA_CREDITO",
  fecha: "2026-10-03T15:00:00Z",
  venta_id: "v-1",
  ventas: { organization_id: "org-1", estado: "COMPLETADA", sucursal_id: null },
}

describe("PATCH /api/caja/movimientos/metodo-pago", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("401 sin sesión", async () => {
    mockAuthError()
    const res = await PATCH(patch({ fuente: "pagos_venta", id: "pv-1", metodoPago: "EFECTIVO" }))
    expect((await parseResponse(res)).status).toBe(401)
  })

  it("400 con método inválido o cuenta corriente como destino", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const res = await PATCH(patch({ fuente: "pagos_venta", id: "pv-1", metodoPago: "CUENTA_CORRIENTE" }))
    expect((await parseResponse(res)).status).toBe(400)
  })

  it("404 si el registro no existe en la org", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ pagos_venta: pagoVentaChain(null) })
    const res = await PATCH(patch({ fuente: "pagos_venta", id: "pv-x", metodoPago: "EFECTIVO" }))
    expect((await parseResponse(res)).status).toBe(404)
  })

  it("corrige un pago de venta y limpia los datos de tarjeta", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const updateSpy = vi.fn().mockReturnValue(createChainMock(null, null))
    const ventasUpdate = vi.fn().mockReturnValue(createChainMock(null, null))
    const pagos = pagoVentaChain(pagoVenta, updateSpy)
    // 1ra lectura: el pago a corregir. 2da: los pagos de la venta (uno solo).
    const respuestas = [{ data: pagoVenta, error: null }, { data: [{ id: "pv-1" }], error: null }]
    pagos.then = (resolve: any) => Promise.resolve(respuestas.shift()).then(resolve)
    mockSupabaseFrom({
      pagos_venta: pagos,
      sesiones_caja: createChainMock([], null),
      ventas: { ...createChainMock(null, null), update: ventasUpdate } as any,
      audit_logs: createChainMock(null, null),
    })

    const res = await PATCH(patch({ fuente: "pagos_venta", id: "pv-1", metodoPago: "EFECTIVO" }))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.metodoPago).toBe("EFECTIVO")
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        metodo_pago: "EFECTIVO",
        cuotas: null,
        costo_financiero_porcentaje: null,
        costo_financiero_monto: null,
      })
    )
    // Venta con un único pago: el método de cabecera acompaña la corrección.
    expect(ventasUpdate).toHaveBeenCalledWith({ metodo_pago: "EFECTIVO" })
  })

  it("rechaza si el pago original fue a cuenta corriente", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const updateSpy = vi.fn()
    mockSupabaseFrom({
      pagos_venta: pagoVentaChain({ ...pagoVenta, metodo_pago: "CUENTA_CORRIENTE" }, updateSpy),
    })
    const res = await PATCH(patch({ fuente: "pagos_venta", id: "pv-1", metodoPago: "EFECTIVO" }))
    expect((await parseResponse(res)).status).toBe(400)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it("rechaza si la venta está anulada", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const updateSpy = vi.fn()
    mockSupabaseFrom({
      pagos_venta: pagoVentaChain(
        { ...pagoVenta, ventas: { ...pagoVenta.ventas, estado: "ANULADA" } },
        updateSpy
      ),
    })
    const res = await PATCH(patch({ fuente: "pagos_venta", id: "pv-1", metodoPago: "EFECTIVO" }))
    expect((await parseResponse(res)).status).toBe(400)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it("rechaza si el movimiento cae en una sesión de caja cerrada", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const updateSpy = vi.fn()
    mockSupabaseFrom({
      pagos_venta: pagoVentaChain(pagoVenta, updateSpy),
      sesiones_caja: createChainMock([{ id: "s-1", sucursal_id: null }], null),
    })
    const res = await PATCH(patch({ fuente: "pagos_venta", id: "pv-1", metodoPago: "EFECTIVO" }))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(400)
    expect(body.error).toMatch(/sesión de caja cerrada/)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it("rechaza un movimiento manual de una sesión cerrada", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const updateSpy = vi.fn()
    mockSupabaseFrom({
      movimientos_caja: pagoVentaChain(
        {
          id: "m-1",
          metodo_pago: "EFECTIVO",
          fecha: "2026-10-03T15:00:00Z",
          sucursal_id: null,
          sesiones_caja: { estado: "CERRADA" },
        },
        updateSpy
      ),
    })
    const res = await PATCH(patch({ fuente: "movimientos_caja", id: "m-1", metodoPago: "TRANSFERENCIA" }))
    expect((await parseResponse(res)).status).toBe(400)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it("404 si el movimiento es de otra sucursal", async () => {
    mockAuthSuccess({ role: "VENDEDOR", sucursalId: "suc-A" })
    const updateSpy = vi.fn()
    mockSupabaseFrom({
      organizations: createChainMock({ vendedores_manejan_caja: true }, null),
      pagos_venta: pagoVentaChain(
        { ...pagoVenta, ventas: { ...pagoVenta.ventas, sucursal_id: "suc-B" } },
        updateSpy
      ),
    })
    const res = await PATCH(patch({ fuente: "pagos_venta", id: "pv-1", metodoPago: "EFECTIVO" }))
    expect((await parseResponse(res)).status).toBe(404)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it("403 para VENDEDOR con el permiso de caja apagado", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    const updateSpy = vi.fn()
    mockSupabaseFrom({
      organizations: createChainMock({ vendedores_manejan_caja: false }, null),
      pagos_venta: pagoVentaChain(pagoVenta, updateSpy),
    })
    const res = await PATCH(patch({ fuente: "pagos_venta", id: "pv-1", metodoPago: "EFECTIVO" }))
    expect((await parseResponse(res)).status).toBe(403)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it("500 (fail-closed) si falla la consulta de sesiones de caja", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const updateSpy = vi.fn()
    mockSupabaseFrom({
      pagos_venta: pagoVentaChain(pagoVenta, updateSpy),
      sesiones_caja: createChainMock(null, { message: "boom" }),
    })
    const res = await PATCH(patch({ fuente: "pagos_venta", id: "pv-1", metodoPago: "EFECTIVO" }))
    expect((await parseResponse(res)).status).toBe(500)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it("de crédito a débito limpia cuotas, recargo y costo financiero", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const updateSpy = vi.fn().mockReturnValue(createChainMock(null, null))
    const pagos = pagoVentaChain(pagoVenta, updateSpy)
    const respuestas = [{ data: pagoVenta, error: null }, { data: [{ id: "pv-1" }, { id: "pv-2" }], error: null }]
    pagos.then = (resolve: any) => Promise.resolve(respuestas.shift()).then(resolve)
    mockSupabaseFrom({
      pagos_venta: pagos,
      sesiones_caja: createChainMock([], null),
      audit_logs: createChainMock(null, null),
    })
    const res = await PATCH(patch({ fuente: "pagos_venta", id: "pv-1", metodoPago: "TARJETA_DEBITO" }))
    expect((await parseResponse(res)).status).toBe(200)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        metodo_pago: "TARJETA_DEBITO",
        cuotas: null,
        recargo_porcentaje: null,
        monto_original: null,
        costo_financiero_porcentaje: null,
        costo_financiero_monto: null,
      })
    )
  })

  it("409 si el movimiento de caja lo generó el sistema", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const updateSpy = vi.fn()
    mockSupabaseFrom({
      movimientos_caja: pagoVentaChain(
        {
          id: "m-2",
          metodo_pago: "EFECTIVO",
          fecha: "2026-10-03T15:00:00Z",
          sucursal_id: null,
          origen: "DEVOLUCION",
          sesiones_caja: { estado: "ABIERTA" },
        },
        updateSpy
      ),
    })
    const res = await PATCH(patch({ fuente: "movimientos_caja", id: "m-2", metodoPago: "TRANSFERENCIA" }))
    expect((await parseResponse(res)).status).toBe(409)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it("500 si falla la actualización de la cabecera de la venta", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const updateSpy = vi.fn().mockReturnValue(createChainMock(null, null))
    const pagos = pagoVentaChain(pagoVenta, updateSpy)
    const respuestas = [{ data: pagoVenta, error: null }, { data: [{ id: "pv-1" }], error: null }]
    pagos.then = (resolve: any) => Promise.resolve(respuestas.shift()).then(resolve)
    mockSupabaseFrom({
      pagos_venta: pagos,
      sesiones_caja: createChainMock([], null),
      ventas: {
        ...createChainMock(null, null),
        update: vi.fn().mockReturnValue(createChainMock(null, { message: "boom" })),
      } as any,
      audit_logs: createChainMock(null, null),
    })
    const res = await PATCH(patch({ fuente: "pagos_venta", id: "pv-1", metodoPago: "EFECTIVO" }))
    expect((await parseResponse(res)).status).toBe(500)
  })

  describe("cuotas_cobro de un cobro de orden", () => {
    const cobro = {
      id: "c-1",
      metodo_pago: "TARJETA_CREDITO",
      created_at: "2026-10-03T15:00:00Z",
      anulado: false,
      orden_id: "o-1",
      ordenes_servicio: { sucursal_id: null },
    }

    function setup(cuotas: any[]) {
      mockAuthSuccess({ role: "ADMIN" })
      const updateSpy = vi.fn().mockReturnValue(createChainMock(null, null))
      const cobros = pagoVentaChain(cobro, updateSpy)
      const cuotasChain = createChainMock(cuotas, null)
      mockSupabaseFrom({
        cobros_orden: cobros,
        sesiones_caja: createChainMock([], null),
        cuotas_cobro: cuotasChain,
        audit_logs: createChainMock(null, null),
      })
      return { updateSpy, cuotasChain }
    }

    it("409 si alguna cuota posterior a la primera ya está pagada", async () => {
      const { updateSpy, cuotasChain } = setup([
        { id: "q1", numero_cuota: 1, pagada: true },
        { id: "q2", numero_cuota: 2, pagada: true },
      ])
      const res = await PATCH(patch({ fuente: "cobros_orden", id: "c-1", metodoPago: "EFECTIVO" }))
      const { status, body } = await parseResponse(res)
      expect(status).toBe(409)
      expect(body.error).toMatch(/cuota/i)
      expect(updateSpy).not.toHaveBeenCalled()
      expect(cuotasChain.delete).not.toHaveBeenCalled()
    })

    it("borra el cronograma si solo la primera cuota (cobrada al vender) está pagada", async () => {
      const { updateSpy, cuotasChain } = setup([
        { id: "q1", numero_cuota: 1, pagada: true },
        { id: "q2", numero_cuota: 2, pagada: false },
      ])
      const res = await PATCH(patch({ fuente: "cobros_orden", id: "c-1", metodoPago: "EFECTIVO" }))
      expect((await parseResponse(res)).status).toBe(200)
      expect(updateSpy).toHaveBeenCalled()
      expect(cuotasChain.delete).toHaveBeenCalled()
    })
  })

  it("la auditoría guarda los valores previos que se limpian y el id completo", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const fila = {
      ...pagoVenta,
      cuotas: 3,
      recargo_porcentaje: 10,
      monto_original: 1000,
      costo_financiero_porcentaje: 5,
      costo_financiero_monto: 50,
    }
    const updateSpy = vi.fn().mockReturnValue(createChainMock(null, null))
    const pagos = pagoVentaChain(fila, updateSpy)
    const respuestas = [{ data: fila, error: null }, { data: [{ id: "pv-1" }, { id: "pv-2" }], error: null }]
    pagos.then = (resolve: any) => Promise.resolve(respuestas.shift()).then(resolve)
    const auditChain = createChainMock(null, null)
    mockSupabaseFrom({
      pagos_venta: pagos,
      sesiones_caja: createChainMock([], null),
      audit_logs: auditChain,
    })
    await PATCH(patch({ fuente: "pagos_venta", id: "pv-1", metodoPago: "EFECTIVO" }))
    const insertado = JSON.stringify((auditChain.insert as any).mock.calls)
    expect(insertado).toContain("costo_financiero_monto")
    expect(insertado).toContain("recargo_porcentaje")
    expect(insertado).toContain('"id":"pv-1"')
  })
})
