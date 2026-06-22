import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createGetRequest, createPostRequest } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/counters", () => ({
  getNextReturnNumber: vi.fn().mockResolvedValue("DEV-000001"),
}))

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    create: vi.fn().mockResolvedValue(undefined),
  })),
}))

import { DELETE as cobrosDELETE } from "@/app/api/ordenes/[id]/cobros/route"
import { POST as devolucionPOST } from "@/app/api/ventas/[id]/devolucion/route"

describe("anular cobro orden — reacredita USO", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Force the JS fallback path by making anular_cobro_orden_atomica report "not found".
    // The JS fallback calls devolver_cuenta_corriente directly so we can assert on it.
    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "anular_cobro_orden_atomica") {
        return Promise.resolve({
          data: null,
          error: { code: "42883", message: "function anular_cobro_orden_atomica does not exist" },
        })
      }
      return Promise.resolve({ data: {}, error: null })
    }) as any)
  })

  it("reacredita (devolver) al anular un cobro con CUENTA_CORRIENTE", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    // orden no entregada; cobro método CUENTA_CORRIENTE
    mockSupabaseFrom({
      ordenes_servicio: createChainMock({ estado: "REPARADO", cliente_id: "c1" }),
      cobros_orden: createChainMock({ id: "cob1", monto: 50, anulado: false, metodo_pago: "CUENTA_CORRIENTE" }),
    })

    await cobrosDELETE(
      createGetRequest("http://localhost/api/ordenes/o1/cobros?cobroId=cob1"),
      { params: Promise.resolve({ id: "o1" }) } as any
    )

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "devolver_cuenta_corriente",
      expect.objectContaining({ p_cliente_id: "c1", p_monto: 50, p_referencia_tipo: "ORDEN", p_referencia_id: "o1" })
    )
  })

  it("NO reacredita al anular un cobro EFECTIVO", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      ordenes_servicio: createChainMock({ estado: "REPARADO", cliente_id: "c1" }),
      cobros_orden: createChainMock({ id: "cob1", monto: 50, anulado: false, metodo_pago: "EFECTIVO" }),
    })

    await cobrosDELETE(
      createGetRequest("http://localhost/api/ordenes/o1/cobros?cobroId=cob1"),
      { params: Promise.resolve({ id: "o1" }) } as any
    )

    const calls = vi.mocked(supabaseAdmin.rpc).mock.calls.map((c) => c[0])
    expect(calls).not.toContain("devolver_cuenta_corriente")
  })
})

describe("devolucion venta — reembolso a CC", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Force JS fallback path: registrar_devolucion_atomica reports "not found".
    // The JS fallback calls devolver_cuenta_corriente directly so we can assert on it.
    // Other RPC calls (e.g. devolver_cuenta_corriente) succeed normally.
    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "registrar_devolucion_atomica") {
        return Promise.resolve({
          data: null,
          error: { code: "42883", message: "function registrar_devolucion_atomica does not exist" },
        })
      }
      return Promise.resolve({ data: {}, error: null })
    }) as any)
  })

  const VENTA_DATA = {
    id: "v1", estado: "COMPLETADA", cliente_id: "c1", organization_id: "org-1",
    items_venta: [{ id: "iv1", cantidad: 5, descripcion: "Item", inventario_id: null, precio_unitario: 10 }],
  }

  /**
   * devoluciones_venta is hit three times in the POST handler:
   *   1. select existing (thenable, no .single()) → must return array
   *   2. insert + select + .single()              → must return { id, items_devolucion: [] }
   *   3. final select + .single() (devolucionCompleta) → same shape
   * We use a call-count approach on the chain mock.
   */
  function buildDevolucionesChain() {
    const insertResult = { id: "d1", items_devolucion: [] }
    let callCount = 0
    const chain: any = {}
    const methods = [
      "select", "insert", "update", "upsert", "delete",
      "eq", "neq", "not", "gte", "lte", "gt", "lt",
      "or", "in", "is", "textSearch", "order", "limit", "range", "maybeSingle",
    ]
    for (const method of methods) {
      chain[method] = vi.fn().mockReturnValue(chain)
    }
    chain.single = vi.fn().mockResolvedValue({ data: insertResult, error: null })
    // Thenable: first call returns [] (existing devoluciones); subsequent calls return insert result
    chain.then = (resolve: any, reject?: any) => {
      callCount++
      const result = callCount === 1 ? { data: [], error: null } : { data: insertResult, error: null }
      return Promise.resolve(result).then(resolve, reject)
    }
    chain.catch = (reject: any) => Promise.resolve({ data: [], error: null }).catch(reject)
    return chain
  }

  it("acredita (devolver) cuando metodoReembolso=CUENTA_CORRIENTE", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock(VENTA_DATA) as any
      if (table === "devoluciones_venta") return buildDevolucionesChain()
      if (table === "items_devolucion") return createChainMock({ id: "id1" }) as any
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    await devolucionPOST(
      createPostRequest({
        motivo: "Defectuoso",
        metodoReembolso: "CUENTA_CORRIENTE",
        items: [{ itemVentaId: "iv1", cantidad: 2, precioUnitario: 10, restaurarStock: false }],
      }, "http://localhost/api/ventas/v1/devolucion"),
      { params: Promise.resolve({ id: "v1" }) } as any
    )

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "devolver_cuenta_corriente",
      expect.objectContaining({ p_cliente_id: "c1", p_monto: 20, p_referencia_tipo: "VENTA", p_referencia_id: "v1" })
    )
  })

  it("NO acredita con metodoReembolso=EFECTIVO", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock(VENTA_DATA) as any
      if (table === "devoluciones_venta") return buildDevolucionesChain()
      if (table === "items_devolucion") return createChainMock({ id: "id1" }) as any
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    await devolucionPOST(
      createPostRequest({
        motivo: "Defectuoso", metodoReembolso: "EFECTIVO",
        items: [{ itemVentaId: "iv1", cantidad: 2, precioUnitario: 10, restaurarStock: false }],
      }, "http://localhost/api/ventas/v1/devolucion"),
      { params: Promise.resolve({ id: "v1" }) } as any
    )

    const calls = vi.mocked(supabaseAdmin.rpc).mock.calls.map((c) => c[0])
    expect(calls).not.toContain("devolver_cuenta_corriente")
  })
})
