import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createChainMock } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/cron-auth", () => ({
  requireCronAuth: vi.fn(() => null),
}))

import { GET } from "@/app/api/cron/subscription-sweep/route"

/**
 * Una suscripcion que el taller cancelo (cancel_at_period_end) termina como
 * CANCELED cuando vence lo pagado: no hay cobro que esperar, asi que no aplica
 * la gracia del debito automatico ni se la marca PAST_DUE ("el pago fallo").
 */
const AHORA_ISO = "2026-08-22T12:00:00.000Z"

const CANCELADA_VENCIDA = {
  id: "sub-1",
  organization_id: "org-1",
  plan_id: "plan-pro",
  payment_provider: "MERCADOPAGO",
  current_period_end: "2026-08-21T12:00:00.000Z",
  mercadopago_preapproval_id: "preap-1",
  cancel_at_period_end: true,
  organizations: { slug: "taller-test" },
  plans: { tipo: "PREMIUM" },
}

describe("GET /api/cron/subscription-sweep — suscripcion cancelada", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(AHORA_ISO))
  })
  afterEach(() => vi.useRealTimers())

  it("al vencer el periodo pasa a CANCELED, sin esperar la gracia de reintentos", async () => {
    let llamadas = 0
    const subsChains: any[] = []
    const historyChain = createChainMock(null, null)
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "plans") return createChainMock({ id: "plan-free-1" }) as any
      if (table === "subscription_history") return historyChain as any
      if (table === "subscriptions") {
        llamadas++
        const chain = createChainMock(llamadas === 1 ? [CANCELADA_VENCIDA] : [])
        subsChains.push(chain)
        return chain as any
      }
      return createChainMock([]) as any
    })

    const res = await GET(new Request("http://localhost/api/cron/subscription-sweep"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.results.canceledAtPeriodEnd).toBe(1)
    expect(body.results.markedPastDue).toBe(0)
    const updates = subsChains.flatMap((c) => c.update.mock.calls.map((x: any[]) => x[0]))
    expect(updates).toContainEqual(expect.objectContaining({ status: "CANCELED" }))
    expect(updates).not.toContainEqual(expect.objectContaining({ status: "PAST_DUE" }))
    expect(historyChain.insert).toHaveBeenCalledWith(expect.objectContaining({ action: "CANCELED" }))
  })
})
