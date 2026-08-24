import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createPostRequest } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"
import { POST as revertirPOST } from "@/app/api/clientes/[id]/cuenta-corriente/revertir/route"

const ctx = { params: Promise.resolve({ id: "c1" }) } as any
const url = "http://localhost/api/clientes/c1/cuenta-corriente/revertir"

function movimientoRow(over: Partial<any> = {}) {
  return {
    id: "mov1", organization_id: "org-1", cliente_id: "c1", tipo: "CARGO",
    monto: "-100", referencia_tipo: "ORDEN", referencia_id: "o1",
    sucursal_id: "suc-1", revertido_at: null, ...over,
  }
}

describe("revertir cargos de fiado", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { revertidos: [{ movimientoId: "mov1", devolucionId: "dev1", monto: 100 }], saldoNuevo: 0 },
      error: null,
    } as any)
  })

  it("revierte un CARGO de orden y llama a la RPC con el motivo", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ cuenta_corriente: createChainMock([movimientoRow()]) })

    const res = await revertirPOST(
      createPostRequest({ movimientoIds: ["mov1"], motivo: "Cargado por error" }, url),
      ctx
    )

    expect(res.status).toBe(200)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "revertir_cargos_orden",
      expect.objectContaining({
        p_org_id: "org-1",
        p_cliente_id: "c1",
        p_movimiento_ids: ["mov1"],
        p_motivo: "Cargado por error",
      })
    )
  })

  it("rechaza a quien no es ADMIN", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })

    const res = await revertirPOST(
      createPostRequest({ movimientoIds: ["mov1"], motivo: "Cargado por error" }, url),
      ctx
    )

    expect(res.status).toBe(403)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("rechaza un movimiento que no es CARGO de orden", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      cuenta_corriente: createChainMock([movimientoRow({ tipo: "DEPOSITO", referencia_tipo: "MANUAL" })]),
    })

    const res = await revertirPOST(
      createPostRequest({ movimientoIds: ["mov1"], motivo: "Cargado por error" }, url),
      ctx
    )

    expect(res.status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("rechaza un movimiento ya revertido", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      cuenta_corriente: createChainMock([movimientoRow({ revertido_at: "2026-08-20T10:00:00Z" })]),
    })

    const res = await revertirPOST(
      createPostRequest({ movimientoIds: ["mov1"], motivo: "Cargado por error" }, url),
      ctx
    )

    expect(res.status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("no revierte ninguno si un movimiento del lote es invalido", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      cuenta_corriente: createChainMock([
        movimientoRow(),
        movimientoRow({ id: "mov2", tipo: "PAGO" }),
      ]),
    })

    const res = await revertirPOST(
      createPostRequest({ movimientoIds: ["mov1", "mov2"], motivo: "Lote equivocado" }, url),
      ctx
    )

    expect(res.status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("exige motivo", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const res = await revertirPOST(
      createPostRequest({ movimientoIds: ["mov1"], motivo: "" }, url),
      ctx
    )

    expect(res.status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("rechaza cuando falta algun movimiento del array", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    // Solo vuelve uno de los dos pedidos: el otro es de otro cliente u otra org.
    mockSupabaseFrom({ cuenta_corriente: createChainMock([movimientoRow()]) })

    const res = await revertirPOST(
      createPostRequest({ movimientoIds: ["mov1", "mov-ajeno"], motivo: "Lote equivocado" }, url),
      ctx
    )

    expect(res.status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })
})
