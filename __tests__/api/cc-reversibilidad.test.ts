import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createGetRequest } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    create: vi.fn().mockResolvedValue(undefined),
  })),
}))

import { DELETE as cobrosDELETE } from "@/app/api/ordenes/[id]/cobros/route"

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
      ordenes_servicio: createChainMock({ estado: "REPARADO", cliente_id: "c1", sucursal_id: "suc-1" }),
      cobros_orden: createChainMock({ id: "cob1", monto: 50, anulado: false, metodo_pago: "CUENTA_CORRIENTE" }),
    })

    await cobrosDELETE(
      createGetRequest("http://localhost/api/ordenes/o1/cobros?cobroId=cob1"),
      { params: Promise.resolve({ id: "o1" }) } as any
    )

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "devolver_cuenta_corriente",
      expect.objectContaining({
        p_cliente_id: "c1", p_monto: 50, p_referencia_tipo: "ORDEN", p_referencia_id: "o1",
        p_sucursal_id: "suc-1",
      })
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

  it("propaga sucursal_id NULL cuando la orden no tiene sucursal asignada", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      ordenes_servicio: createChainMock({ estado: "REPARADO", cliente_id: "c1", sucursal_id: null }),
      cobros_orden: createChainMock({ id: "cob1", monto: 50, anulado: false, metodo_pago: "CUENTA_CORRIENTE" }),
    })

    await cobrosDELETE(
      createGetRequest("http://localhost/api/ordenes/o1/cobros?cobroId=cob1"),
      { params: Promise.resolve({ id: "o1" }) } as any
    )

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "devolver_cuenta_corriente",
      expect.objectContaining({ p_sucursal_id: null })
    )
  })
})
