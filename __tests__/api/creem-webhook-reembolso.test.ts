// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("@/lib/creem", () => ({ verifyCreemSignature: vi.fn(() => true) }))
vi.mock("@/lib/webhook-log", () => ({
  beginWebhookEvent: vi.fn().mockResolvedValue(null),
  finishWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from "@/app/api/creem/webhook/route"

const evento = (eventType: string, object: Record<string, unknown>) =>
  new NextRequest("http://localhost/api/creem/webhook", {
    method: "POST",
    headers: { "creem-signature": "ok" },
    body: JSON.stringify({ id: "evt1", eventType, object }),
  })

const PAGO_REGISTRADO = { id: "sp-1", organization_id: "o1", status: "SUCCEEDED" }

function mockTablas(registrado: unknown = PAGO_REGISTRADO) {
  const subscriptions = createChainMock(null, null)
  const pagos = createChainMock(registrado, null)
  mockSupabaseFrom({
    organizations: createChainMock({ id: "o1", deleted_at: null }, null),
    subscriptions,
    subscription_payments: pagos,
  })
  return { subscriptions, pagos }
}

// Reembolso total de un pago único (plan anual): el pago se registró con el id
// de la orden.
const REEMBOLSO_ORDEN = {
  id: "ref1",
  object: "refund",
  refund_amount: 9900,
  transaction: { id: "tran1", amount_paid: 9900, order: "ord1" },
  order: { id: "ord1" },
}

// Contracargo de un cobro recurrente: el pago se registró con
// `${subscriptionId}:${periodEnd}`.
const DISPUTA_RECURRENTE = {
  id: "disp1",
  object: "dispute",
  amount: 1500,
  transaction: { id: "tran2", amount_paid: 1500, subscription: "sub1" },
  subscription: { id: "sub1", metadata: { organization_id: "o1" } },
}

describe("webhook de Creem — reembolsos y disputas", () => {
  beforeEach(() => vi.clearAllMocks())

  it("refund.created total: marca el pago REFUNDED y pasa la suscripción a PAST_DUE", async () => {
    const { subscriptions, pagos } = mockTablas()

    const { status, body } = await parseResponse(await POST(evento("refund.created", REEMBOLSO_ORDEN)))

    expect(status).toBe(200)
    expect(body.result).toMatchObject({
      status: "PROCESSED",
      reason: "payment_refunded_access_revoked",
      organizationId: "o1",
    })
    expect(pagos.eq).toHaveBeenCalledWith("provider_payment_id", "ord1")
    expect(pagos.eq).toHaveBeenCalledWith("payment_provider", "CREEM")
    expect(pagos.update).toHaveBeenCalledWith({ status: "REFUNDED" })
    expect(subscriptions.update).toHaveBeenCalledWith(expect.objectContaining({ status: "PAST_DUE" }))
    expect(subscriptions.eq).toHaveBeenCalledWith("organization_id", "o1")
    expect(subscriptions.upsert).not.toHaveBeenCalled()
  })

  it("dispute.created de un cobro recurrente: ubica el pago por la suscripción y revoca", async () => {
    const { subscriptions, pagos } = mockTablas()

    const { status, body } = await parseResponse(await POST(evento("dispute.created", DISPUTA_RECURRENTE)))

    expect(status).toBe(200)
    expect(body.result).toMatchObject({ status: "PROCESSED", reason: "payment_charged_back_access_revoked" })
    expect(pagos.like).toHaveBeenCalledWith("provider_payment_id", "sub1:%")
    expect(pagos.update).toHaveBeenCalledWith({ status: "REFUNDED" })
    expect(subscriptions.update).toHaveBeenCalledWith(expect.objectContaining({ status: "PAST_DUE" }))
  })

  it("reentrega del mismo reembolso: SKIPPED already_processed sin tocar nada", async () => {
    const { subscriptions, pagos } = mockTablas({ ...PAGO_REGISTRADO, status: "REFUNDED" })

    const { status, body } = await parseResponse(await POST(evento("refund.created", REEMBOLSO_ORDEN)))

    expect(status).toBe(200)
    expect(body.result).toMatchObject({ status: "SKIPPED", reason: "already_processed" })
    expect(pagos.update).not.toHaveBeenCalled()
    expect(subscriptions.update).not.toHaveBeenCalled()
  })

  it("reembolso parcial: solo se registra, no se revoca", async () => {
    const { subscriptions, pagos } = mockTablas()

    const { status, body } = await parseResponse(
      await POST(evento("refund.created", { ...REEMBOLSO_ORDEN, refund_amount: 2000 }))
    )

    expect(status).toBe(200)
    expect(body.result).toMatchObject({ status: "SKIPPED", reason: "refund_partial" })
    expect(pagos.update).not.toHaveBeenCalled()
    expect(subscriptions.update).not.toHaveBeenCalled()
  })

  it("reembolso de un pago que no está registrado: no toca la suscripción", async () => {
    const { subscriptions } = mockTablas(null)

    const { status, body } = await parseResponse(await POST(evento("refund.created", REEMBOLSO_ORDEN)))

    expect(status).toBe(200)
    expect(body.result).toMatchObject({ status: "SKIPPED", reason: "refund_payment_not_registered" })
    expect(subscriptions.update).not.toHaveBeenCalled()
  })
})
