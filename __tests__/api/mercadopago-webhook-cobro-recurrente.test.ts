import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createChainMock, mockSupabaseFrom } from "./helpers"

import {
  handlePaymentNotification,
  preApprovalIdFromPayment,
} from "@/app/api/mercadopago/webhook/route"

/**
 * Los cobros del débito automático no traen external_reference: lo lleva solo
 * la adhesión (preapproval). Cuando MercadoPago avisaba el cobro como
 * `payment` (o el superadmin lo reconciliaba por Payment ID), el handler lo
 * descartaba con missing_organization_id y la suscripción no se renovaba: había
 * que conciliar a mano. Ahora la organización se resuelve por la adhesión.
 */
const COBRO_RECURRENTE = {
  id: 190000000001,
  status: "approved",
  transaction_amount: 19999,
  currency_id: "ARS",
  date_approved: "2026-11-20T10:00:00.000Z",
  external_reference: null,
  metadata: { preapproval_id: "pre-abc" },
  payer: { id: 123 },
}

const ADHESION = {
  id: "pre-abc",
  external_reference: JSON.stringify({
    organization_id: "org-1",
    billing_period: "MONTHLY",
    plan_slug: "profesional",
  }),
}

function mockFetch(preapprovalOk = true) {
  global.fetch = vi.fn(async (url: any) => {
    const u = String(url)
    if (u.includes("/v1/payments/")) return new Response(JSON.stringify(COBRO_RECURRENTE), { status: 200 })
    if (u.includes("/preapproval/")) {
      return preapprovalOk
        ? new Response(JSON.stringify(ADHESION), { status: 200 })
        : new Response("boom", { status: 500 })
    }
    return new Response("not found", { status: 404 })
  }) as any
}

describe("handlePaymentNotification — cobro del débito automático sin external_reference", () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it("encuentra el id de la adhesión en los distintos campos que usa MP", () => {
    expect(preApprovalIdFromPayment({ metadata: { preapproval_id: "a" } })).toBe("a")
    expect(
      preApprovalIdFromPayment({ point_of_interaction: { transaction_data: { subscription_id: "b" } } })
    ).toBe("b")
    expect(preApprovalIdFromPayment({})).toBeNull()
  })

  it("resuelve la organización por la adhesión y renueva la suscripción", async () => {
    mockFetch()
    const subscriptions = createChainMock(null, null)
    mockSupabaseFrom({
      organizations: createChainMock({ id: "org-1", activo: true }),
      subscription_payments: createChainMock(null, null),
      plans: createChainMock({ id: "plan-1", slug: "profesional" }),
      subscriptions,
    })

    const r = await handlePaymentNotification("190000000001")

    expect(r).toMatchObject({ status: "PROCESSED", organizationId: "org-1" })
    expect(subscriptions.upsert).toHaveBeenCalled()
  })

  it("si la API de MP falla, usa la adhesión guardada en la suscripción", async () => {
    mockFetch(false)
    const subscriptions = createChainMock({ id: "sub-1", organization_id: "org-1", billing_period: "MONTHLY" }, null)
    mockSupabaseFrom({
      organizations: createChainMock({ id: "org-1", activo: true }),
      subscription_payments: createChainMock(null, null),
      plans: createChainMock({ id: "plan-1", slug: "profesional" }),
      subscriptions,
    })

    const r = await handlePaymentNotification("190000000001")

    expect(r.organizationId).toBe("org-1")
    expect(r.reason).not.toBe("missing_organization_id")
  })
})
