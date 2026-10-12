import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  })),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { PUT } from "@/app/api/ventas/[id]/route"

function put(body: any, id = "v1"): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`http://localhost:3000/api/ventas/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  ]
}

const item = (precioUnitario: number, cantidad = 1) => ({
  inventarioId: "i1",
  descripcion: "Mouse",
  cantidad,
  precioUnitario,
})

const edicion = (extra: Record<string, unknown> = {}) => ({
  action: "edit",
  clienteNombre: "Ana",
  items: [item(100)],
  ...extra,
})

const ventaBase = {
  id: "v1",
  estado: "COMPLETADA",
  cliente_id: null,
  cliente_nombre: "Ana",
  total: 100,
  monto_abonado: 100,
  metodo_pago: "EFECTIVO",
  sucursal_id: "suc-1",
  items_venta: [],
  pagos_venta: [{ metodo_pago: "EFECTIVO", monto: "100" }],
}

function mockVenta(venta: Record<string, unknown>, extra: Record<string, any> = {}) {
  mockSupabaseFrom({
    ventas: createChainMock({ ...ventaBase, ...venta }),
    organizations: createChainMock({ iva_regimen: "EXENTO" }),
    ...extra,
  })
}

describe("PUT /api/ventas/[id] — qué no se puede editar", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { success: true, estadoPago: "PAGADO" }, error: null } as any)
  })

  it.each([
    ["devoluciones", { devoluciones_venta: [{ id: "d1" }] }, /devoluciones/],
    ["factura electrónica", { comprobantes_fiscales: [{ id: "cf1", estado: "emitido" }] }, /factura electrónica/],
    ["remito", { facturas: [{ id: "f1" }] }, /remito/],
    ["nota de crédito", { notas_credito: [{ id: "nc1", anulada: false }] }, /nota de crédito/],
    ["comisión liquidada", { comision_pagada: true }, /comisión/],
    ["series", { inventario_series: [{ id: "s1" }] }, /número de serie/],
  ])("rechaza una venta con %s sin llamar al RPC", async (_n, extra, mensaje) => {
    mockVenta(extra)
    const { status, body } = await parseResponse(await PUT(...put(edicion())))
    expect(status).toBe(409)
    expect(body.error).toMatch(mensaje)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("una nota de crédito anulada no bloquea", async () => {
    mockVenta({ notas_credito: [{ id: "nc1", anulada: true }] })
    const { status } = await parseResponse(await PUT(...put(edicion())))
    expect(status).toBe(200)
  })

  it("el total no puede quedar por debajo de lo cobrado", async () => {
    mockVenta({})
    const { status, body } = await parseResponse(await PUT(...put(edicion({ items: [item(80)] }))))
    expect(status).toBe(409)
    expect(body.error).toMatch(/menor a lo ya cobrado/)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("no cambia el método de una venta cobrada (los pagos ya están en la caja)", async () => {
    mockVenta({})
    const { status, body } = await parseResponse(await PUT(...put(edicion({ metodoPago: "TARJETA_CREDITO" }))))
    expect(status).toBe(400)
    expect(body.error).toMatch(/método de pago/)
  })

  it("sin metodoPago en el body conserva el de la venta", async () => {
    mockVenta({ metodo_pago: "TRANSFERENCIA", pagos_venta: [{ metodo_pago: "TRANSFERENCIA", monto: "100" }] })
    const { status } = await parseResponse(await PUT(...put(edicion())))
    expect(status).toBe(200)
    expect(vi.mocked(supabaseAdmin.rpc).mock.calls[0][1]).toMatchObject({ p_metodo_pago: "TRANSFERENCIA" })
  })

  it("rechaza un cliente que no es de la organización", async () => {
    mockVenta({}, { clientes: createChainMock(null) })
    const { status, body } = await parseResponse(await PUT(...put(edicion({ clienteId: "c-otra-org" }))))
    expect(status).toBe(400)
    expect(body.error).toMatch(/Cliente no encontrado/)
  })

  it("con saldo en la cuenta del cliente, no deja pasar la venta a otro cliente", async () => {
    mockVenta(
      { cliente_id: "c1", monto_abonado: 0, pagos_venta: [] },
      { clientes: createChainMock({ id: "c2" }) }
    )
    const { status, body } = await parseResponse(await PUT(...put(edicion({ clienteId: "c2" }))))
    expect(status).toBe(409)
    expect(body.error).toMatch(/cambiar el cliente/)
  })

  it("valida el body: cantidad 0 es 400", async () => {
    mockVenta({})
    const { status, body } = await parseResponse(await PUT(...put(edicion({ items: [item(100, 0)] }))))
    expect(status).toBe(400)
    expect(body.error).toMatch(/cantidad/)
  })

  it("mapea el P0021 del SQL a 409 con el motivo", async () => {
    mockVenta({})
    vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({
      data: null,
      error: { code: "P0021", message: "VENTA_NO_EDITABLE: La venta tiene un remito generado." },
    } as any)
    const { status, body } = await parseResponse(await PUT(...put(edicion())))
    expect(status).toBe(409)
    expect(body.error).toBe("No se puede editar: La venta tiene un remito generado.")
  })
})

describe("PUT /api/ventas/[id] — saldo pendiente y cuenta corriente", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
  })

  function capturarUpdateVentas() {
    const updates: any[] = []
    const fetchChain = createChainMock({ ...ventaBase, cliente_id: "c1", total: 200, monto_abonado: 0, pagos_venta: [] })
    const updateChain = createChainMock({ ...ventaBase })
    updateChain.update = vi.fn((payload: any) => {
      updates.push(payload)
      return updateChain
    })
    let llamadas = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return (++llamadas === 1 ? fetchChain : updateChain) as any
      if (table === "clientes") return createChainMock({ id: "c1" }) as any
      if (table === "organizations") return createChainMock({ iva_regimen: "EXENTO" }) as any
      return createChainMock(null) as any
    })
    return updates
  }

  it("sin la migración 328 recalcula estado_pago y carga la diferencia en la cuenta del cliente", async () => {
    const updates = capturarUpdateVentas()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: null } as any)

    const { status } = await parseResponse(
      await PUT(...put(edicion({ clienteId: "c1", items: [item(150, 2)] })))
    )

    expect(status).toBe(200)
    const calls = vi.mocked(supabaseAdmin.rpc).mock.calls
    expect(calls[0][0]).toBe("editar_venta_atomica")
    expect(calls[1]).toEqual([
      "cargar_deuda_cuenta_corriente",
      expect.objectContaining({ p_cliente_id: "c1", p_monto: 100, p_referencia_id: "v1" }),
    ])
    expect(updates).toContainEqual(expect.objectContaining({ estado_pago: "PENDIENTE" }))
  })

  it("con la migración 328 el RPC ya lo hizo: no repite el ajuste", async () => {
    const updates = capturarUpdateVentas()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { success: true, estadoPago: "PENDIENTE", ajusteCuentaCorriente: 100 },
      error: null,
    } as any)

    const { status } = await parseResponse(
      await PUT(...put(edicion({ clienteId: "c1", items: [item(150, 2)] })))
    )

    expect(status).toBe(200)
    expect(vi.mocked(supabaseAdmin.rpc).mock.calls).toHaveLength(1)
    expect(updates).toHaveLength(0)
  })
})
