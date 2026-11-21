import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockSupabaseFrom, mockAuthSuccess, parseResponse } from "./helpers"

vi.mock("@/lib/mercadopago", () => ({
  cancelPreApproval: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/rebill", () => ({
  cancelRebillSubscription: vi.fn().mockResolvedValue(undefined),
}))

import { cancelPreApproval } from "@/lib/mercadopago"
import { cancelRebillSubscription } from "@/lib/rebill"
import { POST } from "@/app/api/subscriptions/cancel/route"

const subBase = {
  id: "sub-1",
  organization_id: "org-1",
  payment_provider: "MERCADOPAGO",
  mercadopago_preapproval_id: "mp-pre-1",
  rebill_subscription_id: null,
}

describe("POST /api/subscriptions/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(cancelPreApproval).mockResolvedValue(undefined as never)
    vi.mocked(cancelRebillSubscription).mockResolvedValue(undefined as never)
    mockAuthSuccess({ role: "ADMIN" })
  })

  it("cancela en MercadoPago cuando hay preapproval", async () => {
    const subscriptions = createChainMock(subBase)
    mockSupabaseFrom({ subscriptions })

    const res = await POST()
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(cancelPreApproval).toHaveBeenCalledWith("mp-pre-1")
    expect(cancelRebillSubscription).not.toHaveBeenCalled()
    expect(subscriptions.update).toHaveBeenCalledWith(
      expect.objectContaining({ cancel_at_period_end: true })
    )
  })

  it("una fila con un id viejo de Creem se cancela igual: Creem ya no existe", async () => {
    // Quedaron filas con creem_subscription_id de cuando existio ese rail.
    const subscriptions = createChainMock({
      ...subBase,
      payment_provider: "MANUAL",
      mercadopago_preapproval_id: null,
      creem_subscription_id: "sub_viejo",
    })
    mockSupabaseFrom({ subscriptions })

    const res = await POST()
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(cancelPreApproval).not.toHaveBeenCalled()
    expect(subscriptions.update).toHaveBeenCalledWith(
      expect.objectContaining({ cancel_at_period_end: true })
    )
  })

  it("intenta cancelar en MercadoPago aunque falle un id viejo de otro proveedor", async () => {
    // Fila con suscripción de Rebill vieja + preapproval de MP activo: el fallo
    // de Rebill no debe impedir la cancelación en el proveedor que cobra.
    vi.mocked(cancelRebillSubscription).mockRejectedValue(new Error("rebill stale"))
    const subscriptions = createChainMock({
      ...subBase,
      rebill_subscription_id: "rb-viejo",
    })
    mockSupabaseFrom({ subscriptions })

    const res = await POST()
    const { status } = await parseResponse(res)

    expect(cancelPreApproval).toHaveBeenCalledWith("mp-pre-1")
    expect(status).toBe(500)
    expect(subscriptions.update).not.toHaveBeenCalled()
  })

  it("responde 500 y no marca cancelada en la base si MercadoPago rechaza la cancelación", async () => {
    vi.mocked(cancelPreApproval).mockRejectedValue(new Error("mp down"))
    const subscriptions = createChainMock(subBase)
    mockSupabaseFrom({ subscriptions })

    const res = await POST()
    const { status } = await parseResponse(res)

    expect(status).toBe(500)
    expect(subscriptions.update).not.toHaveBeenCalled()
  })
})
