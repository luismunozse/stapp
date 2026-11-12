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

const ORG_ACTIVA = createChainMock({ id: "org-1", deleted_at: null }, null)

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
    mockSupabaseFrom({ subscriptions: subs, organizations: ORG_ACTIVA })

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
    mockSupabaseFrom({ subscriptions: subs, organizations: ORG_ACTIVA })

    await handlePreApprovalNotification("pre-1")

    const escrito = subs.update.mock.calls[0][0]
    expect(escrito).not.toHaveProperty("current_period_end")
  })

  it("mapea paused a PAST_DUE", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ...PREAPPROVAL, status: "paused" }), { status: 200 })
    ) as never
    const subs = createChainMock(null, null)
    mockSupabaseFrom({ subscriptions: subs, organizations: ORG_ACTIVA })

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
    mockSupabaseFrom({ subscriptions: subs, organizations: ORG_ACTIVA })

    const r = await handlePreApprovalNotification("pre-1")

    expect(r.status).toBe("SKIPPED")
    expect(subs.update).not.toHaveBeenCalled()
  })

  it("no activa nada si la organizacion esta dada de baja", async () => {
    const subs = createChainMock(null, null)
    const orgs = createChainMock({ id: "org-1", deleted_at: "2026-10-01T00:00:00Z" }, null)
    mockSupabaseFrom({ subscriptions: subs, organizations: orgs })

    const r = await handlePreApprovalNotification("pre-1")

    expect(r).toMatchObject({ status: "SKIPPED", reason: "org_deleted_or_missing" })
    expect(subs.update).not.toHaveBeenCalled()
  })

  describe("baja de la adhesion", () => {
    const cancelada = () => {
      global.fetch = vi.fn(async () =>
        new Response(JSON.stringify({ ...PREAPPROVAL, status: "cancelled" }), { status: 200 })
      ) as never
    }
    const futuro = new Date(Date.now() + 10 * 86400_000).toISOString()
    const pasado = new Date(Date.now() - 86400_000).toISOString()

    it("con el periodo pago vigente sigue ACTIVE hasta el fin, marcada para cancelar", async () => {
      cancelada()
      const subs = createChainMock(
        { id: "sub-1", status: "ACTIVE", mercadopago_preapproval_id: "pre-1", current_period_end: futuro, canceled_at: null },
        null,
      )
      mockSupabaseFrom({ subscriptions: subs, organizations: ORG_ACTIVA })

      const r = await handlePreApprovalNotification("pre-1")

      expect(r.status).toBe("PROCESSED")
      expect(subs.update).toHaveBeenCalledTimes(1)
      const escrito = subs.update.mock.calls[0][0]
      expect(escrito.cancel_at_period_end).toBe(true)
      expect(escrito).not.toHaveProperty("status")
    })

    it("con el periodo vencido pasa a CANCELED", async () => {
      cancelada()
      const subs = createChainMock(
        { id: "sub-1", status: "ACTIVE", mercadopago_preapproval_id: "pre-1", current_period_end: pasado, canceled_at: null },
        null,
      )
      mockSupabaseFrom({ subscriptions: subs, organizations: ORG_ACTIVA })

      await handlePreApprovalNotification("pre-1")

      expect(subs.update).toHaveBeenCalledWith(expect.objectContaining({ status: "CANCELED" }))
    })

    it("la baja de una adhesion vieja no toca la vigente", async () => {
      cancelada()
      const subs = createChainMock(
        { id: "sub-1", status: "ACTIVE", mercadopago_preapproval_id: "pre-nueva", current_period_end: pasado, canceled_at: null },
        null,
      )
      mockSupabaseFrom({ subscriptions: subs, organizations: ORG_ACTIVA })

      const r = await handlePreApprovalNotification("pre-1")

      expect(r.status).toBe("SKIPPED")
      expect(subs.update).not.toHaveBeenCalled()
    })

    it("volver a adherir limpia una cancelacion pendiente", async () => {
      const subs = createChainMock(
        { id: "sub-1", status: "ACTIVE", mercadopago_preapproval_id: "pre-vieja", current_period_end: futuro, canceled_at: pasado },
        null,
      )
      mockSupabaseFrom({ subscriptions: subs, organizations: ORG_ACTIVA })

      await handlePreApprovalNotification("pre-1")

      expect(subs.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: "ACTIVE", mercadopago_preapproval_id: "pre-1", cancel_at_period_end: false })
      )
    })
  })
})
