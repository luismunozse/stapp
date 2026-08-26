/**
 * MercadoPago arranca a cobrar una adhesion (PreApproval) en la fecha de
 * autorizacion salvo que se le mande auto_recurring.start_date. Para un taller
 * que YA pago y tiene periodo vigente eso significa un cobro inmediato por algo
 * que todavia no consumio: justo la gente que mas queremos adherir es la que
 * peor la pasa. Estos tests fijan que la fecha de inicio viaje cuando existe.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { preApprovalCreate } = vi.hoisted(() => ({ preApprovalCreate: vi.fn() }))

vi.mock("mercadopago", () => ({
  MercadoPagoConfig: class {},
  Preference: class {},
  PreApproval: class {
    create = preApprovalCreate
  },
}))

vi.mock("@/lib/pricing", () => ({
  getPlanBySlug: vi.fn(async () => ({
    id: "plan-pro",
    slug: "profesional",
    nombre: "Profesional",
    ars: { monthly: 19999, yearly: 149999 },
    usd: { monthly: 14, yearly: 107 },
  })),
}))

import { createSubscription } from "@/lib/mercadopago"

const ARGS = {
  organizationId: "org-1",
  organizationName: "Taller",
  email: "taller@test.com",
  billingPeriod: "MONTHLY" as const,
  backUrl: "https://stapp.com.ar/configuracion/billing",
}

function bodyEnviado() {
  return preApprovalCreate.mock.calls[0][0].body
}

describe("createSubscription — cuando arranca a cobrar la adhesion", () => {
  beforeEach(() => {
    process.env.MERCADOPAGO_ACCESS_TOKEN = "test-token"
    preApprovalCreate.mockReset()
    preApprovalCreate.mockResolvedValue({
      id: "pre-1",
      init_point: "https://mp.test/adherir/pre-1",
    })
  })

  it("con startDate se lo pasa a MercadoPago, para no cobrar el periodo ya pagado", async () => {
    await createSubscription({ ...ARGS, startDate: "2026-10-19T00:00:00.000Z" })

    expect(bodyEnviado().auto_recurring.start_date).toBe("2026-10-19T00:00:00.000Z")
  })

  it("sin startDate no manda el campo: MercadoPago cobra al autorizar", async () => {
    await createSubscription(ARGS)

    expect(bodyEnviado().auto_recurring).not.toHaveProperty("start_date")
  })

  it("la fecha de inicio no toca el resto de la adhesion", async () => {
    await createSubscription({ ...ARGS, startDate: "2026-10-19T00:00:00.000Z" })

    const { auto_recurring } = bodyEnviado()
    expect(auto_recurring.frequency).toBe(1)
    expect(auto_recurring.frequency_type).toBe("months")
    expect(auto_recurring.transaction_amount).toBe(19999)
  })
})
