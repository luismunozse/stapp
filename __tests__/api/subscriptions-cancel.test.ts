import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockSupabaseFrom, mockAuthSuccess, parseResponse } from "./helpers"

vi.mock("@/lib/mercadopago", () => ({
  cancelPreApproval: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/rebill", () => ({
  cancelRebillSubscription: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/creem", () => ({
  cancelCreemSubscription: vi.fn().mockResolvedValue(undefined),
}))

import { cancelPreApproval } from "@/lib/mercadopago"
import { cancelRebillSubscription } from "@/lib/rebill"
import { cancelCreemSubscription } from "@/lib/creem"
import { POST } from "@/app/api/subscriptions/cancel/route"

const subBase = {
  id: "sub-1",
  organization_id: "org-1",
  payment_provider: "CREEM",
  mercadopago_preapproval_id: null,
  rebill_subscription_id: null,
  creem_subscription_id: "creem-sub-123",
}

describe("POST /api/subscriptions/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
  })

  it("cancela en Creem cuando la suscripción es de Creem", async () => {
    const subscriptions = createChainMock(subBase)
    mockSupabaseFrom({ subscriptions })

    const res = await POST()
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(cancelCreemSubscription).toHaveBeenCalledWith("creem-sub-123")
    expect(cancelPreApproval).not.toHaveBeenCalled()
    expect(cancelRebillSubscription).not.toHaveBeenCalled()
    expect(subscriptions.update).toHaveBeenCalledWith(
      expect.objectContaining({ cancel_at_period_end: true })
    )
  })

  it("cancela en MercadoPago cuando hay preapproval (sin tocar Creem)", async () => {
    const subscriptions = createChainMock({
      ...subBase,
      payment_provider: "MERCADOPAGO",
      mercadopago_preapproval_id: "mp-pre-1",
      creem_subscription_id: null,
    })
    mockSupabaseFrom({ subscriptions })

    const res = await POST()
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(cancelPreApproval).toHaveBeenCalledWith("mp-pre-1")
    expect(cancelCreemSubscription).not.toHaveBeenCalled()
  })

  it("intenta cancelar en Creem aunque falle un id viejo de otro proveedor", async () => {
    // Fila con preapproval de MP viejo + suscripción Creem activa: el fallo de
    // MP no debe impedir la cancelación en Creem (el proveedor que cobra).
    vi.mocked(cancelPreApproval).mockRejectedValue(new Error("mp stale"))
    const subscriptions = createChainMock({
      ...subBase,
      mercadopago_preapproval_id: "mp-pre-viejo",
    })
    mockSupabaseFrom({ subscriptions })

    const res = await POST()
    const { status } = await parseResponse(res)

    expect(cancelCreemSubscription).toHaveBeenCalledWith("creem-sub-123")
    expect(status).toBe(500)
    expect(subscriptions.update).not.toHaveBeenCalled()
  })

  it("responde 500 y no marca cancelada en la base si Creem rechaza la cancelación", async () => {
    vi.mocked(cancelCreemSubscription).mockRejectedValue(new Error("creem down"))
    const subscriptions = createChainMock(subBase)
    mockSupabaseFrom({ subscriptions })

    const res = await POST()
    const { status } = await parseResponse(res)

    expect(status).toBe(500)
    expect(subscriptions.update).not.toHaveBeenCalled()
  })
})
