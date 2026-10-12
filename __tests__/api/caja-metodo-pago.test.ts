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
    const res = await PATCH(
      patch({ fuente: "pagos_venta", id: "pv-1", metodoPago: "TARJETA_DEBITO", costoFinancieroPorcentaje: null })
    )
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
    const [fila0] = (auditChain.insert as any).mock.calls[0]
    expect(fila0.entity_id).toBe("v-1")
    expect(fila0.changes.before).toMatchObject({
      metodo_pago: "TARJETA_CREDITO",
      cuotas: 3,
      recargo_porcentaje: 10,
      monto_original: 1000,
      costo_financiero_porcentaje: 5,
      costo_financiero_monto: 50,
    })
    expect(fila0.changes.after).toMatchObject({
      metodo_pago: "EFECTIVO",
      fuente: "pagos_venta",
      id: "pv-1",
      costo_financiero_porcentaje: null,
      costo_financiero_monto: null,
    })
  })

  describe("costo de terminal al corregir a tarjeta", () => {
    function setupPago(row: any, cantidadPagos = 2) {
      mockAuthSuccess({ role: "ADMIN" })
      const updateSpy = vi.fn().mockReturnValue(createChainMock(null, null))
      const pagos = pagoVentaChain(row, updateSpy)
      const respuestas = [
        { data: row, error: null },
        { data: Array.from({ length: cantidadPagos }, (_, i) => ({ id: `pv-${i}` })), error: null },
      ]
      pagos.then = (resolve: any) => Promise.resolve(respuestas.shift()).then(resolve)
      const auditChain = createChainMock(null, null)
      mockSupabaseFrom({
        pagos_venta: pagos,
        sesiones_caja: createChainMock([], null),
        audit_logs: auditChain,
      })
      return { updateSpy, auditChain }
    }
    const credito = {
      ...pagoVenta,
      monto: "1000",
      cuotas: 3,
      recargo_porcentaje: 10,
      monto_original: 909.09,
      costo_financiero_porcentaje: 4,
      costo_financiero_monto: 40,
    }
    const efectivo = { ...pagoVenta, metodo_pago: "EFECTIVO", monto: "1000" }

    it("a débito guarda porcentaje y monto sobre el monto del pago, y limpia cuotas y recargo", async () => {
      const { updateSpy } = setupPago(credito)
      const res = await PATCH(
        patch({ fuente: "pagos_venta", id: "pv-1", metodoPago: "TARJETA_DEBITO", costoFinancieroPorcentaje: 2.5 })
      )
      expect((await parseResponse(res)).status).toBe(200)
      expect(updateSpy).toHaveBeenCalledWith({
        metodo_pago: "TARJETA_DEBITO",
        cuotas: null,
        recargo_porcentaje: null,
        monto_original: null,
        costo_financiero_porcentaje: 2.5,
        costo_financiero_monto: 25,
      })
    })

    it("a crédito desde otro método guarda solo el costo financiero (pago único, sin cuotas ni recargo)", async () => {
      const { updateSpy } = setupPago(efectivo)
      const res = await PATCH(
        patch({ fuente: "pagos_venta", id: "pv-1", metodoPago: "TARJETA_CREDITO", costoFinancieroPorcentaje: 3 })
      )
      expect((await parseResponse(res)).status).toBe(200)
      expect(updateSpy).toHaveBeenCalledWith({
        metodo_pago: "TARJETA_CREDITO",
        costo_financiero_porcentaje: 3,
        costo_financiero_monto: 30,
      })
    })

    it("redondea el monto del costo a 2 decimales", async () => {
      const { updateSpy } = setupPago({ ...efectivo, monto: "100.5" })
      await PATCH(
        patch({ fuente: "pagos_venta", id: "pv-1", metodoPago: "TARJETA_DEBITO", costoFinancieroPorcentaje: 2.5 })
      )
      expect(updateSpy.mock.calls[0][0].costo_financiero_monto).toBe(2.51)
    })

    it("sin porcentaje (o en 0) deja el costo financiero en null", async () => {
      const { updateSpy } = setupPago(credito)
      await PATCH(
        patch({ fuente: "pagos_venta", id: "pv-1", metodoPago: "TARJETA_DEBITO", costoFinancieroPorcentaje: 0 })
      )
      expect(updateSpy.mock.calls[0][0]).toMatchObject({
        costo_financiero_porcentaje: null,
        costo_financiero_monto: null,
      })
    })

    it("con el porcentaje omitido conserva el costo ya guardado (solo limpia cuotas y recargo)", async () => {
      const { updateSpy } = setupPago(credito)
      await PATCH(patch({ fuente: "pagos_venta", id: "pv-1", metodoPago: "TARJETA_DEBITO" }))
      const enviado = updateSpy.mock.calls[0][0]
      expect(enviado).toMatchObject({ cuotas: null, recargo_porcentaje: null, monto_original: null })
      expect(enviado).not.toHaveProperty("costo_financiero_porcentaje")
      expect(enviado).not.toHaveProperty("costo_financiero_monto")
    })

    it("con un método que no es tarjeta ignora el porcentaje y limpia las cinco columnas", async () => {
      const { updateSpy } = setupPago(credito)
      const res = await PATCH(
        patch({ fuente: "pagos_venta", id: "pv-1", metodoPago: "EFECTIVO", costoFinancieroPorcentaje: 5 })
      )
      expect((await parseResponse(res)).status).toBe(200)
      expect(updateSpy).toHaveBeenCalledWith({
        metodo_pago: "EFECTIVO",
        cuotas: null,
        recargo_porcentaje: null,
        monto_original: null,
        costo_financiero_porcentaje: null,
        costo_financiero_monto: null,
      })
    })

    it.each([101, -1, "abc"])("400 si el porcentaje es inválido (%s)", async (valor) => {
      const { updateSpy } = setupPago(credito)
      const res = await PATCH(
        patch({ fuente: "pagos_venta", id: "pv-1", metodoPago: "TARJETA_DEBITO", costoFinancieroPorcentaje: valor })
      )
      expect((await parseResponse(res)).status).toBe(400)
      expect(updateSpy).not.toHaveBeenCalled()
    })

    it("la auditoría registra los valores del costo antes y después", async () => {
      const { auditChain } = setupPago(credito)
      await PATCH(
        patch({ fuente: "pagos_venta", id: "pv-1", metodoPago: "TARJETA_DEBITO", costoFinancieroPorcentaje: 2.5 })
      )
      const [fila] = (auditChain.insert as any).mock.calls[0]
      expect(fila.changes.before).toMatchObject({ costo_financiero_porcentaje: 4, costo_financiero_monto: 40 })
      expect(fila.changes.after).toMatchObject({ costo_financiero_porcentaje: 2.5, costo_financiero_monto: 25 })
    })

    it("en un cobro de orden usa el monto del cobro como base", async () => {
      mockAuthSuccess({ role: "ADMIN" })
      const upd = createChainMock(null, null)
      const updateSpy = vi.fn().mockReturnValue(upd)
      mockSupabaseFrom({
        cobros_orden: pagoVentaChain(
          {
            id: "c-1",
            metodo_pago: "EFECTIVO",
            monto: "800",
            created_at: "2026-10-03T15:00:00Z",
            anulado: false,
            orden_id: "o-1",
            ordenes_servicio: { sucursal_id: null },
          },
          updateSpy
        ),
        sesiones_caja: createChainMock([], null),
        cuotas_cobro: createChainMock([], null),
        audit_logs: createChainMock(null, null),
      })
      const res = await PATCH(
        patch({ fuente: "cobros_orden", id: "c-1", metodoPago: "TARJETA_DEBITO", costoFinancieroPorcentaje: 5 })
      )
      expect((await parseResponse(res)).status).toBe(200)
      expect(updateSpy.mock.calls[0][0]).toMatchObject({
        costo_financiero_porcentaje: 5,
        costo_financiero_monto: 40,
      })
    })
  })

  describe("fallas de lectura y de cabecera", () => {
    it("500 si falla la lectura del registro (no se confunde con 404)", async () => {
      mockAuthSuccess({ role: "ADMIN" })
      mockSupabaseFrom({ pagos_venta: createChainMock(null, { message: "connection reset" }) })
      const res = await PATCH(patch({ fuente: "pagos_venta", id: "pv-1", metodoPago: "EFECTIVO" }))
      expect((await parseResponse(res)).status).toBe(500)
    })

    it("500 si falla la lectura de un depósito de cuenta corriente", async () => {
      mockAuthSuccess({ role: "ADMIN" })
      mockSupabaseFrom({ cuenta_corriente: createChainMock(null, { message: "connection reset" }) })
      const res = await PATCH(patch({ fuente: "cuenta_corriente", id: "cc-1", metodoPago: "EFECTIVO" }))
      expect((await parseResponse(res)).status).toBe(500)
    })

    it("500 si la lectura de un movimiento falla por algo que no es la columna origen", async () => {
      mockAuthSuccess({ role: "ADMIN" })
      mockSupabaseFrom({ movimientos_caja: createChainMock(null, { message: "connection reset" }) })
      const res = await PATCH(patch({ fuente: "movimientos_caja", id: "m-1", metodoPago: "EFECTIVO" }))
      expect((await parseResponse(res)).status).toBe(500)
    })

    it("500 si falla el conteo de pagos de la venta (no deja la cabecera a medias en silencio)", async () => {
      mockAuthSuccess({ role: "ADMIN" })
      const updateSpy = vi.fn().mockReturnValue(createChainMock(null, null))
      const ventasUpdate = vi.fn().mockReturnValue(createChainMock(null, null))
      const pagos = pagoVentaChain(pagoVenta, updateSpy)
      const respuestas = [{ data: pagoVenta, error: null }, { data: null, error: { message: "boom" } }]
      pagos.then = (resolve: any) => Promise.resolve(respuestas.shift()).then(resolve)
      mockSupabaseFrom({
        pagos_venta: pagos,
        sesiones_caja: createChainMock([], null),
        ventas: { ...createChainMock(null, null), update: ventasUpdate } as any,
        audit_logs: createChainMock(null, null),
      })
      const res = await PATCH(patch({ fuente: "pagos_venta", id: "pv-1", metodoPago: "EFECTIVO" }))
      expect((await parseResponse(res)).status).toBe(500)
      expect(ventasUpdate).not.toHaveBeenCalled()
    })
  })

  describe("otras fuentes y filtros por organización", () => {
    it("cuenta_corriente: actualiza solo el método, filtrado por id y organización", async () => {
      mockAuthSuccess({ role: "ADMIN" })
      const upd = createChainMock(null, null)
      const updateSpy = vi.fn().mockReturnValue(upd)
      const cc = pagoVentaChain(
        {
          id: "cc-1",
          metodo_pago: "EFECTIVO",
          created_at: "2026-10-03T15:00:00Z",
          tipo: "DEPOSITO",
          sucursal_id: null,
        },
        updateSpy
      )
      mockSupabaseFrom({
        cuenta_corriente: cc,
        sesiones_caja: createChainMock([], null),
        audit_logs: createChainMock(null, null),
      })
      const res = await PATCH(patch({ fuente: "cuenta_corriente", id: "cc-1", metodoPago: "TRANSFERENCIA" }))
      expect((await parseResponse(res)).status).toBe(200)
      expect(updateSpy).toHaveBeenCalledWith({ metodo_pago: "TRANSFERENCIA" })
      expect(upd.eq).toHaveBeenCalledWith("id", "cc-1")
      expect(upd.eq).toHaveBeenCalledWith("organization_id", "org-1")
      expect(cc.eq).toHaveBeenCalledWith("organization_id", "org-1")
    })

    it("movimientos_caja: actualiza solo el método, filtrado por id y organización", async () => {
      mockAuthSuccess({ role: "ADMIN" })
      const upd = createChainMock(null, null)
      const updateSpy = vi.fn().mockReturnValue(upd)
      mockSupabaseFrom({
        movimientos_caja: pagoVentaChain(
          {
            id: "m-1",
            metodo_pago: "EFECTIVO",
            fecha: "2026-10-03T15:00:00Z",
            sucursal_id: null,
            origen: "MANUAL",
            sesiones_caja: { estado: "ABIERTA" },
          },
          updateSpy
        ),
        sesiones_caja: createChainMock([], null),
        audit_logs: createChainMock(null, null),
      })
      const res = await PATCH(patch({ fuente: "movimientos_caja", id: "m-1", metodoPago: "TRANSFERENCIA" }))
      expect((await parseResponse(res)).status).toBe(200)
      expect(updateSpy).toHaveBeenCalledWith({ metodo_pago: "TRANSFERENCIA" })
      expect(upd.eq).toHaveBeenCalledWith("id", "m-1")
      expect(upd.eq).toHaveBeenCalledWith("organization_id", "org-1")
    })

    it("movimientos_caja: sin la columna origen (mig 335) relee con el respaldo y corrige", async () => {
      mockAuthSuccess({ role: "ADMIN" })
      const upd = createChainMock(null, null)
      const updateSpy = vi.fn().mockReturnValue(upd)
      const mov = pagoVentaChain(null, updateSpy)
      const respuestas = [
        { data: null, error: { code: "42703", message: "column movimientos_caja.origen does not exist" } },
        {
          data: {
            id: "m-1",
            metodo_pago: "EFECTIVO",
            fecha: "2026-10-03T15:00:00Z",
            sucursal_id: null,
            tipo: "EGRESO",
            afecta_rentabilidad: true,
            es_recurrente: false,
            concepto: "Compra de insumos",
            sesiones_caja: { estado: "ABIERTA" },
          },
          error: null,
        },
      ]
      mov.then = (resolve: any) => Promise.resolve(respuestas.shift()).then(resolve)
      mockSupabaseFrom({
        movimientos_caja: mov,
        sesiones_caja: createChainMock([], null),
        audit_logs: createChainMock(null, null),
      })
      const res = await PATCH(patch({ fuente: "movimientos_caja", id: "m-1", metodoPago: "TRANSFERENCIA" }))
      expect((await parseResponse(res)).status).toBe(200)
      expect(mov.select).toHaveBeenCalledTimes(2)
      expect(String(mov.select.mock.calls[1][0])).toContain("concepto")
      expect(updateSpy).toHaveBeenCalledWith({ metodo_pago: "TRANSFERENCIA" })
    })
  })

  describe("cronograma cuotas_cobro: filtros, errores y reintento", () => {
    const cobroCredito = {
      id: "c-1",
      metodo_pago: "TARJETA_CREDITO",
      monto: "500",
      created_at: "2026-10-03T15:00:00Z",
      anulado: false,
      orden_id: "o-1",
      ordenes_servicio: { sucursal_id: null },
    }

    function setupCobro(cobro: any, cuotasChain: any) {
      mockAuthSuccess({ role: "ADMIN" })
      const upd = createChainMock(null, null)
      const updateSpy = vi.fn().mockReturnValue(upd)
      const auditChain = createChainMock(null, null)
      mockSupabaseFrom({
        cobros_orden: pagoVentaChain(cobro, updateSpy),
        sesiones_caja: createChainMock([], null),
        cuotas_cobro: cuotasChain,
        audit_logs: auditChain,
      })
      return { upd, updateSpy, auditChain }
    }

    /** Args de los `.eq` encadenados entre dos llamadas (por orden global de invocación). */
    function eqEntre(chain: any, desde: any, hasta?: any) {
      const ini = desde.mock.invocationCallOrder[0]
      const fin = hasta ? hasta.mock.invocationCallOrder[0] : Infinity
      return chain.eq.mock.calls.filter((_: any, i: number) => {
        const o = chain.eq.mock.invocationCallOrder[i]
        return o > ini && o < fin
      })
    }

    it("lee y borra el cronograma filtrando por cobro y organización; el update final también", async () => {
      const cuotasChain = createChainMock(
        [
          { id: "q1", numero_cuota: 1, pagada: true },
          { id: "q2", numero_cuota: 2, pagada: false },
        ],
        null
      )
      const { upd } = setupCobro(cobroCredito, cuotasChain)
      const res = await PATCH(patch({ fuente: "cobros_orden", id: "c-1", metodoPago: "EFECTIVO" }))
      expect((await parseResponse(res)).status).toBe(200)

      const lectura = eqEntre(cuotasChain, cuotasChain.select, cuotasChain.delete)
      expect(lectura).toContainEqual(["cobro_id", "c-1"])
      expect(lectura).toContainEqual(["organization_id", "org-1"])
      const borrado = eqEntre(cuotasChain, cuotasChain.delete)
      expect(borrado).toContainEqual(["cobro_id", "c-1"])
      expect(borrado).toContainEqual(["organization_id", "org-1"])
      expect(upd.eq).toHaveBeenCalledWith("id", "c-1")
      expect(upd.eq).toHaveBeenCalledWith("organization_id", "org-1")
    })

    it("500 si falla la lectura del cronograma y no toca el cobro", async () => {
      const { updateSpy } = setupCobro(cobroCredito, createChainMock(null, { message: "boom" }))
      const res = await PATCH(patch({ fuente: "cobros_orden", id: "c-1", metodoPago: "EFECTIVO" }))
      expect((await parseResponse(res)).status).toBe(500)
      expect(updateSpy).not.toHaveBeenCalled()
    })

    it("500 si falla el borrado del cronograma e indica que el método ya cambió", async () => {
      const cuotasChain = createChainMock([{ id: "q1", numero_cuota: 1, pagada: true }], null)
      const respuestas = [
        { data: [{ id: "q1", numero_cuota: 1, pagada: true }], error: null },
        { data: null, error: { message: "boom" } },
      ]
      cuotasChain.then = (resolve: any) => Promise.resolve(respuestas.shift()).then(resolve)
      const { updateSpy } = setupCobro(cobroCredito, cuotasChain)
      const res = await PATCH(patch({ fuente: "cobros_orden", id: "c-1", metodoPago: "EFECTIVO" }))
      const { status, body } = await parseResponse(res)
      expect(status).toBe(500)
      expect(updateSpy).toHaveBeenCalled()
      expect(body.error).toMatch(/cuotas/i)
    })

    it("reintento: con el método ya cambiado, borra las cuotas huérfanas antes del corte por mismo método", async () => {
      const huerfanas = createChainMock(
        [
          { id: "q1", numero_cuota: 1, pagada: true },
          { id: "q2", numero_cuota: 2, pagada: false },
        ],
        null
      )
      const { updateSpy, auditChain } = setupCobro({ ...cobroCredito, metodo_pago: "EFECTIVO" }, huerfanas)
      const res = await PATCH(patch({ fuente: "cobros_orden", id: "c-1", metodoPago: "EFECTIVO" }))
      expect((await parseResponse(res)).status).toBe(200)
      expect(huerfanas.delete).toHaveBeenCalled()
      expect(eqEntre(huerfanas, huerfanas.delete)).toContainEqual(["cobro_id", "c-1"])
      expect(eqEntre(huerfanas, huerfanas.delete)).toContainEqual(["organization_id", "org-1"])
      expect(updateSpy).not.toHaveBeenCalled()
      const [fila] = (auditChain.insert as any).mock.calls[0]
      expect(fila.changes.before.cuotas_borradas).toBe(2)
    })

    it("sin cuotas huérfanas el mismo método sigue siendo un no-op", async () => {
      const vacio = createChainMock([], null)
      const { updateSpy, auditChain } = setupCobro({ ...cobroCredito, metodo_pago: "EFECTIVO" }, vacio)
      const res = await PATCH(patch({ fuente: "cobros_orden", id: "c-1", metodoPago: "EFECTIVO" }))
      expect((await parseResponse(res)).status).toBe(200)
      expect(vacio.delete).not.toHaveBeenCalled()
      expect(updateSpy).not.toHaveBeenCalled()
      expect(auditChain.insert).not.toHaveBeenCalled()
    })

    it("la auditoría registra cuántas cuotas del cronograma se borraron", async () => {
      const cuotasChain = createChainMock(
        [
          { id: "q1", numero_cuota: 1, pagada: true },
          { id: "q2", numero_cuota: 2, pagada: false },
          { id: "q3", numero_cuota: 3, pagada: false },
        ],
        null
      )
      const { auditChain } = setupCobro(cobroCredito, cuotasChain)
      await PATCH(patch({ fuente: "cobros_orden", id: "c-1", metodoPago: "EFECTIVO" }))
      const [fila] = (auditChain.insert as any).mock.calls[0]
      expect(fila.changes.before.cuotas_borradas).toBe(3)
    })
  })
})
