import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createChainMock, mockSupabaseFrom } from "./helpers"

import { handlePreApprovalNotification } from "@/app/api/mercadopago/webhook/route"

const PREAPPROVAL = {
  id: "pre-1",
  status: "authorized",
  external_reference: JSON.stringify({
    organization_id: "org-1",
    billing_period: "MONTHLY",
    plan_id: "plan-pro",
    plan_slug: "profesional",
  }),
}

describe("handlePreApprovalNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify(PREAPPROVAL), { status: 200 })
    ) as never
  })

  afterEach(() => vi.restoreAllMocks())

  it("activa la suscripcion CON el plan de la adhesion, no con el que tenia", async () => {
    const subs = createChainMock(null, null)
    mockSupabaseFrom({ subscriptions: subs })

    await handlePreApprovalNotification("pre-1")

    expect(subs.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ACTIVE",
        plan_id: "plan-pro",
        billing_period: "MONTHLY",
        payment_provider: "MERCADOPAGO",
        mercadopago_preapproval_id: "pre-1",
      })
    )
  })

  it("no inventa un periodo: eso lo fija el primer cobro", async () => {
    const subs = createChainMock(null, null)
    mockSupabaseFrom({ subscriptions: subs })

    await handlePreApprovalNotification("pre-1")

    const escrito = subs.update.mock.calls[0][0]
    expect(escrito).not.toHaveProperty("current_period_end")
  })

  it("mapea paused a PAST_DUE", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ...PREAPPROVAL, status: "paused" }), { status: 200 })
    ) as never
    const subs = createChainMock(null, null)
    mockSupabaseFrom({ subscriptions: subs })

    await handlePreApprovalNotification("pre-1")

    expect(subs.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "PAST_DUE" })
    )
  })

  it("un estado desconocido no rompe ni activa nada", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ...PREAPPROVAL, status: "pending" }), { status: 200 })
    ) as never
    const subs = createChainMock(null, null)
    mockSupabaseFrom({ subscriptions: subs })

    const r = await handlePreApprovalNotification("pre-1")

    expect(r.status).toBe("SKIPPED")
    expect(subs.update).not.toHaveBeenCalled()
  })
})
