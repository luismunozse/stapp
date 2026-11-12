import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockSupabaseFrom } from "../api/helpers"
import { hasValidAccess } from "@/lib/subscriptions"

const PLAN_PRO = { id: "plan-pro", nombre: "Profesional", tipo: "PREMIUM", slug: "profesional", features: [] }

function sub(over: Record<string, unknown>) {
  return createChainMock({
    id: "sub-1",
    status: "ACTIVE",
    billing_period: "MONTHLY",
    payment_provider: "MERCADOPAGO",
    mercadopago_preapproval_id: "pre-1",
    trial_end: null,
    cancel_at_period_end: false,
    plans: PLAN_PRO,
    ...over,
  })
}

const futuro = () => new Date(Date.now() + 5 * 86400_000).toISOString()
const pasado = () => new Date(Date.now() - 86400_000).toISOString()
const pasadoSinGracia = () => new Date(Date.now() - 13 * 86400_000).toISOString()

describe("hasValidAccess — suscripcion cancelada por el taller", () => {
  beforeEach(() => vi.clearAllMocks())

  it("mantiene el acceso hasta el fin del periodo pago", async () => {
    const subs = sub({ current_period_end: futuro(), cancel_at_period_end: true })
    mockSupabaseFrom({ subscriptions: subs, organizations: createChainMock({ slug: "taller" }) })
    const r = await hasValidAccess("org-1")
    expect(r.hasAccess).toBe(true)
    expect(subs.update).not.toHaveBeenCalled()
  })

  it("al vencer el periodo pasa a CANCELED (no a PAST_DUE)", async () => {
    const subs = sub({ current_period_end: pasado(), cancel_at_period_end: true })
    mockSupabaseFrom({ subscriptions: subs, organizations: createChainMock({ slug: "taller" }) })
    const r = await hasValidAccess("org-1")
    expect(r).toMatchObject({ hasAccess: false, reason: "canceled" })
    expect(subs.update).toHaveBeenCalledWith(expect.objectContaining({ status: "CANCELED" }))
  })

  it("con debito automatico, dentro de la gracia de reintentos sigue con acceso", async () => {
    const subs = sub({ current_period_end: pasado() })
    mockSupabaseFrom({ subscriptions: subs, organizations: createChainMock({ slug: "taller" }) })
    const r = await hasValidAccess("org-1")
    expect(r.hasAccess).toBe(true)
    expect(subs.update).not.toHaveBeenCalled()
  })

  it("sin cancelacion y pasada la gracia, va a PAST_DUE", async () => {
    const subs = sub({ current_period_end: pasadoSinGracia() })
    mockSupabaseFrom({ subscriptions: subs, organizations: createChainMock({ slug: "taller" }) })
    const r = await hasValidAccess("org-1")
    expect(r).toMatchObject({ hasAccess: false, reason: "past_due" })
    expect(subs.update).toHaveBeenCalledWith(expect.objectContaining({ status: "PAST_DUE" }))
  })
})
