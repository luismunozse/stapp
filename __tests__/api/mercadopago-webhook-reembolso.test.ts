import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createChainMock, mockSupabaseFrom } from "./helpers"

import { handlePaymentNotification } from "@/app/api/mercadopago/webhook/route"

/**
 * Un pago de suscripción que se reembolsa por completo o recibe un contracargo
 * deja de pagar el período que había extendido: el pago queda REFUNDED y la
 * suscripción pasa a PAST_DUE (sin acceso pago).
 *
 * El estado sale SIEMPRE del re-fetch autenticado a la API de MercadoPago, no
 * del body de la notificación. Los cobros recurrentes no traen
 * external_reference, por eso el pago se ubica por provider_payment_id.
 */
const PAGO_BASE = {
  id: 174586824094,
  transaction_amount: 19999,
  currency_id: "ARS",
  date_approved: "2026-08-19T13:31:18.000Z",
  payer: { id: 123 },
}

const PAGO_REGISTRADO = { id: "sp-1", organization_id: "org-1", status: "SUCCEEDED" }

function mockPagoMP(payment: Record<string, unknown>) {
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ ...PAGO_BASE, ...payment }), { status: 200 })
  ) as any
}

function mockTablas(registrado: unknown = PAGO_REGISTRADO) {
  const subscriptions = createChainMock(null, null)
  const pagos = createChainMock(registrado, null)
  mockSupabaseFrom({
    organizations: createChainMock({ id: "org-1", activo: true }),
    subscription_payments: pagos,
    plans: createChainMock({ id: "plan-1", slug: "profesional" }),
    subscriptions,
  })
  return { subscriptions, pagos }
}

describe("handlePaymentNotification — reembolsos y contracargos", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("reembolso total: marca el pago REFUNDED y pasa la suscripción a PAST_DUE", async () => {
    mockPagoMP({ status: "refunded", transaction_amount_refunded: 19999 })
    const { subscriptions, pagos } = mockTablas()

    const r = await handlePaymentNotification("174586824094")

    expect(r).toMatchObject({
      status: "PROCESSED",
      reason: "payment_refunded_access_revoked",
      organizationId: "org-1",
      subscriptionPaymentId: "sp-1",
    })
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.mercadopago.com/v1/payments/174586824094",
      expect.anything()
    )
    expect(pagos.eq).toHaveBeenCalledWith("provider_payment_id", "174586824094")
    expect(pagos.eq).toHaveBeenCalledWith("payment_provider", "MERCADOPAGO")
    expect(pagos.update).toHaveBeenCalledWith({ status: "REFUNDED" })
    expect(subscriptions.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "PAST_DUE" })
    )
    expect(subscriptions.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(subscriptions.upsert).not.toHaveBeenCalled()
    expect(pagos.insert).not.toHaveBeenCalled()
  })

  it("contracargo: mismo tratamiento, con su propio motivo en el registro", async () => {
    mockPagoMP({ status: "charged_back" })
    const { subscriptions, pagos } = mockTablas()

    const r = await handlePaymentNotification("174586824094")

    expect(r).toMatchObject({ status: "PROCESSED", reason: "payment_charged_back_access_revoked" })
    expect(pagos.update).toHaveBeenCalledWith({ status: "REFUNDED" })
    expect(subscriptions.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "PAST_DUE" })
    )
  })

  it("reintento del mismo reembolso: no vuelve a tocar nada", async () => {
    mockPagoMP({ status: "refunded" })
    const { subscriptions, pagos } = mockTablas({ ...PAGO_REGISTRADO, status: "REFUNDED" })

    const r = await handlePaymentNotification("174586824094")

    expect(r).toMatchObject({ status: "SKIPPED", reason: "already_processed" })
    expect(pagos.update).not.toHaveBeenCalled()
    expect(subscriptions.update).not.toHaveBeenCalled()
  })

  it("dos notificaciones concurrentes: la que no marca el pago lo reconoce como ya procesado", async () => {
    mockPagoMP({ status: "refunded" })
    const { pagos } = mockTablas()
    pagos.update.mockReturnValue(createChainMock([], null))

    const r = await handlePaymentNotification("174586824094")

    expect(r).toMatchObject({ status: "SKIPPED", reason: "already_processed" })
  })

  it("reembolso de un pago que nunca se registró: no toca la suscripción", async () => {
    mockPagoMP({ status: "refunded" })
    const { subscriptions } = mockTablas(null)

    const r = await handlePaymentNotification("174586824094")

    expect(r).toMatchObject({ status: "SKIPPED", reason: "refund_payment_not_registered" })
    expect(subscriptions.update).not.toHaveBeenCalled()
    expect(subscriptions.upsert).not.toHaveBeenCalled()
  })

  it("reembolso parcial: no revoca el acceso ni marca el pago", async () => {
    mockPagoMP({
      status: "approved",
      status_detail: "partially_refunded",
      transaction_amount_refunded: 5000,
      external_reference: JSON.stringify({ organization_id: "org-1", plan_slug: "profesional" }),
    })
    const { subscriptions, pagos } = mockTablas()

    const r = await handlePaymentNotification("174586824094")

    expect(r).toMatchObject({ status: "SKIPPED", reason: "already_processed" })
    expect(pagos.update).not.toHaveBeenCalled()
    expect(subscriptions.update).not.toHaveBeenCalled()
    expect(subscriptions.upsert).not.toHaveBeenCalled()
  })
})
