import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createPostRequest } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"
import { POST as cobrosPOST } from "@/app/api/ordenes/[id]/cobros/route"
import { POST as ventaPagosPOST } from "@/app/api/ventas/[id]/pagos/route"

function ordenRow(over: Partial<any> = {}) {
  return {
    id: "o1", costo_final: "100", total_cobrado: "0", estado_cobro: "PENDIENTE",
    descuento_cobro: "0", cliente_id: "c1", organization_id: "org-1",
    estado: "ENTREGADO", ...over,
  }
}

describe("cobros orden — reconciliación de fiado", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Force the JS fallback path by making registrar_cobros_orden_atomica report "not found".
    // The JS fallback issues individual RPC calls (usar_cuenta_corriente,
    // pagar_fiado_cuenta_corriente) so we can assert on them directly.
    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "registrar_cobros_orden_atomica") {
        return Promise.resolve({
          data: null,
          error: { code: "42883", message: "function registrar_cobros_orden_atomica does not exist" },
        })
      }
      return Promise.resolve({ data: {}, error: null })
    }) as any)
  })

  it("acredita PAGO al cobrar en efectivo una orden ENTREGADA", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      ordenes_servicio: createChainMock(ordenRow()),
      cobros_orden: createChainMock({ id: "cob1" }),
    })

    await cobrosPOST(
      createPostRequest({ pagos: [{ monto: 40, metodo: "EFECTIVO" }] }, "http://localhost/api/ordenes/o1/cobros"),
      { params: Promise.resolve({ id: "o1" }) } as any
    )

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "pagar_fiado_cuenta_corriente",
      expect.objectContaining({ p_cliente_id: "c1", p_monto: 40, p_referencia_tipo: "ORDEN", p_referencia_id: "o1" })
    )
  })

  it("NO acredita si la orden NO está entregada", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      ordenes_servicio: createChainMock(ordenRow({ estado: "REPARADO" })),
      cobros_orden: createChainMock({ id: "cob1" }),
    })

    await cobrosPOST(
      createPostRequest({ pagos: [{ monto: 40, metodo: "EFECTIVO" }] }, "http://localhost/api/ordenes/o1/cobros"),
      { params: Promise.resolve({ id: "o1" }) } as any
    )

    const calls = vi.mocked(supabaseAdmin.rpc).mock.calls.map((c) => c[0])
    expect(calls).not.toContain("pagar_fiado_cuenta_corriente")
  })

  it("con método CUENTA_CORRIENTE usa usar_cuenta_corriente, no pagar_fiado", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      ordenes_servicio: createChainMock(ordenRow()),
      cobros_orden: createChainMock({ id: "cob1" }),
    })

    await cobrosPOST(
      createPostRequest({ pagos: [{ monto: 40, metodo: "CUENTA_CORRIENTE" }] }, "http://localhost/api/ordenes/o1/cobros"),
      { params: Promise.resolve({ id: "o1" }) } as any
    )

    const calls = vi.mocked(supabaseAdmin.rpc).mock.calls.map((c) => c[0])
    expect(calls).toContain("usar_cuenta_corriente")
    expect(calls).not.toContain("pagar_fiado_cuenta_corriente")
  })
})

describe("pagos venta — reconciliación de fiado", () => {
  // The fiado/CC reconciliation for venta pagos now lives inside the atomic
  // plpgsql RPC (registrar_pagos_venta_atomica), which vitest can't execute.
  // To keep asserting the reconciliation calls (usar_cuenta_corriente /
  // pagar_fiado_cuenta_corriente), we force the JS fallback path by making the
  // atomic RPC report "function missing" (PGRST202); the route then runs the
  // legacy JS implementation that issues those calls directly.
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "registrar_pagos_venta_atomica") {
        return Promise.resolve({
          data: null,
          error: { code: "PGRST202", message: "Could not find the function" },
        })
      }
      return Promise.resolve({ data: {}, error: null })
    }) as any)
  })

  it("acredita PAGO al pagar en efectivo una venta a fiado", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      ventas: createChainMock({ id: "v1", total: "100", monto_abonado: "0", estado: "COMPLETADA", cliente_id: "c1", organization_id: "org-1" }),
      pagos_venta: createChainMock({ id: "p1", monto: 40, metodo_pago: "EFECTIVO" }),
    })

    await ventaPagosPOST(
      createPostRequest({ pagos: [{ monto: 40, metodo: "EFECTIVO" }] }, "http://localhost/api/ventas/v1/pagos"),
      { params: Promise.resolve({ id: "v1" }) } as any
    )

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "pagar_fiado_cuenta_corriente",
      expect.objectContaining({ p_cliente_id: "c1", p_monto: 40, p_referencia_tipo: "VENTA", p_referencia_id: "v1" })
    )
  })

  it("con CUENTA_CORRIENTE usa usar, no pagar_fiado", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      ventas: createChainMock({ id: "v1", total: "100", monto_abonado: "0", estado: "COMPLETADA", cliente_id: "c1", organization_id: "org-1" }),
      pagos_venta: createChainMock({ id: "p1" }),
    })

    await ventaPagosPOST(
      createPostRequest({ pagos: [{ monto: 40, metodo: "CUENTA_CORRIENTE" }] }, "http://localhost/api/ventas/v1/pagos"),
      { params: Promise.resolve({ id: "v1" }) } as any
    )

    const calls = vi.mocked(supabaseAdmin.rpc).mock.calls.map((c) => c[0])
    expect(calls).toContain("usar_cuenta_corriente")
    expect(calls).not.toContain("pagar_fiado_cuenta_corriente")
  })
})
