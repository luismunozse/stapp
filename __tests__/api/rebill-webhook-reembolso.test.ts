// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("@/lib/webhook-log", () => ({
  beginWebhookEvent: vi.fn().mockResolvedValue(null),
  finishWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from "@/app/api/rebill/webhook/route"
import { finishWebhookEvent } from "@/lib/webhook-log"

const evento = (event: string, data: Record<string, unknown>) =>
  new NextRequest("http://localhost/api/rebill/webhook", {
    method: "POST",
    body: JSON.stringify({ event, data }),
  })

const PAGO_REGISTRADO = { id: "sp-1", organization_id: "o1", status: "SUCCEEDED" }

function mockTablas(registrado: unknown = PAGO_REGISTRADO, errorPagos: unknown = null) {
  const subscriptions = createChainMock(null, null)
  const pagos = createChainMock(registrado, errorPagos)
  mockSupabaseFrom({
    organizations: createChainMock({ id: "o1", activo: true, deleted_at: null }, null),
    subscriptions,
    subscription_payments: pagos,
    plans: createChainMock({ id: "plan1", slug: "profesional" }, null),
  })
  return { subscriptions, pagos }
}

function registro() {
  return vi.mocked(finishWebhookEvent).mock.calls.at(-1)?.[1]
}

const pago = (status: string) => ({
  id: "pay1",
  status,
  amount: 10,
  metadata: { organization_id: "o1", plan_slug: "profesional" },
})

describe("webhook de Rebill — reembolsos, contracargos y robustez", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.REBILL_WEBHOOK_TOKEN
  })

  it("pago reembolsado: marca el pago REFUNDED y pasa la suscripción a PAST_DUE", async () => {
    const { subscriptions, pagos } = mockTablas()

    const { status } = await parseResponse(await POST(evento("payment.updated", pago("refunded"))))

    expect(status).toBe(200)
    expect(registro()).toMatchObject({ status: "PROCESSED", errorMessage: "payment_refunded_access_revoked" })
    expect(pagos.eq).toHaveBeenCalledWith("provider_payment_id", "pay1")
    expect(pagos.eq).toHaveBeenCalledWith("payment_provider", "REBILL")
    expect(pagos.update).toHaveBeenCalledWith({ status: "REFUNDED" })
    expect(subscriptions.update).toHaveBeenCalledWith(expect.objectContaining({ status: "PAST_DUE" }))
    expect(subscriptions.upsert).not.toHaveBeenCalled()
    expect(pagos.insert).not.toHaveBeenCalled()
  })

  it.each(["chargeback", "CHARGED_BACK"])("contracargo (%s): revoca con su propio motivo", async (estado) => {
    const { subscriptions, pagos } = mockTablas()

    await POST(evento("payment.updated", pago(estado)))

    expect(registro()).toMatchObject({ status: "PROCESSED", errorMessage: "payment_charged_back_access_revoked" })
    expect(pagos.update).toHaveBeenCalledWith({ status: "REFUNDED" })
    expect(subscriptions.update).toHaveBeenCalledWith(expect.objectContaining({ status: "PAST_DUE" }))
  })

  it("reentrega del mismo reembolso: SKIPPED already_processed", async () => {
    const { subscriptions, pagos } = mockTablas({ ...PAGO_REGISTRADO, status: "REFUNDED" })

    await POST(evento("payment.updated", pago("refunded")))

    expect(registro()).toMatchObject({ status: "SKIPPED", errorMessage: "already_processed" })
    expect(pagos.update).not.toHaveBeenCalled()
    expect(subscriptions.update).not.toHaveBeenCalled()
  })

  it("reembolso parcial: solo se registra", async () => {
    const { subscriptions, pagos } = mockTablas()

    await POST(evento("payment.updated", pago("partially_refunded")))

    expect(registro()).toMatchObject({ status: "SKIPPED", errorMessage: "refund_partial" })
    expect(pagos.update).not.toHaveBeenCalled()
    expect(subscriptions.update).not.toHaveBeenCalled()
  })

  it("pago aprobado duplicado (23505): 200 already_processed y no extiende la suscripción", async () => {
    const { subscriptions } = mockTablas(null, { code: "23505", message: "duplicate key value" })

    const { status } = await parseResponse(await POST(evento("payment.created", pago("approved"))))

    expect(status).toBe(200)
    expect(registro()).toMatchObject({ status: "SKIPPED", httpStatus: 200, errorMessage: "already_processed" })
    expect(subscriptions.upsert).not.toHaveBeenCalled()
  })

  it("estado de suscripción desconocido: no toca la suscripción", async () => {
    const { subscriptions } = mockTablas()

    const { status } = await parseResponse(
      await POST(
        evento("subscription.updated", {
          id: "s1",
          status: "algo_nuevo",
          metadata: { organization_id: "o1" },
        })
      )
    )

    expect(status).toBe(200)
    expect(registro()).toMatchObject({ status: "SKIPPED", errorMessage: "subscription_status_algo_nuevo" })
    expect(subscriptions.update).not.toHaveBeenCalled()
  })
})
