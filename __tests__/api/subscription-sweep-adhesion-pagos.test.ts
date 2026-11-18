import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createChainMock } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/cron-auth", () => ({ requireCronAuth: vi.fn(() => null) }))

import { GET } from "@/app/api/cron/subscription-sweep/route"

// La fila de suscripción es una por organización y se reutiliza. El barrido de
// adhesiones sin primer cobro tiene que medir desde la adhesión vigente
// (mercadopago_preapproval_at), no desde la creación de la fila, y contar solo
// los pagos posteriores: un pago de hace un año no prueba que esta adhesión
// haya cobrado.

const AHORA_ISO = "2026-11-13T12:00:00.000Z"
const hace = (dias: number) => new Date(new Date(AHORA_ISO).getTime() - dias * 86400_000).toISOString()

function correr(adhesion: Record<string, unknown>, pagosExitosos: number) {
  let llamadasSubs = 0
  const subsChains: any[] = []
  const pagos = createChainMock(null, null, pagosExitosos)
  const history = createChainMock(null, null)
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "subscription_payments") return pagos as any
    if (table === "subscription_history") return history as any
    if (table === "plans") return createChainMock({ id: "plan-free" }) as any
    if (table === "subscriptions") {
      llamadasSubs++
      const chain = createChainMock(llamadasSubs === 2 ? [adhesion] : [])
      subsChains.push(chain)
      return chain as any
    }
    return createChainMock(null) as any
  })
  return { pagos, history, subsChains }
}

const base = {
  id: "sub-1",
  organization_id: "org-1",
  created_at: hace(400),
  current_period_end: null,
  mercadopago_preapproval_id: "preap-1",
  organizations: { slug: "taller" },
  plans: { tipo: "PREMIUM" },
}

describe("subscription-sweep — adhesión sin primer cobro", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(AHORA_ISO))
  })
  afterEach(() => vi.useRealTimers())

  it("cuenta solo los pagos desde que se autorizó la adhesión", async () => {
    const autorizada = hace(20)
    const { pagos } = correr({ ...base, mercadopago_preapproval_at: autorizada }, 0)

    await GET(new Request("http://localhost/api/cron/subscription-sweep"))

    expect(pagos.gte).toHaveBeenCalledWith("paid_at", autorizada)
  })

  it("adhesión de hace 20 días sin cobros propios: PAST_DUE aunque la fila sea vieja", async () => {
    const { history } = correr({ ...base, mercadopago_preapproval_at: hace(20) }, 0)

    const body = await (await GET(new Request("http://localhost/api/cron/subscription-sweep"))).json()

    expect(body.results.markedPastDue).toBe(1)
    expect(history.insert).toHaveBeenCalledWith(
      expect.objectContaining({ details: { reason: "adhesion_sin_primer_cobro" } })
    )
  })

  it("una org vieja que adhirió hace 2 días no se bloquea: todavía espera el primer cobro", async () => {
    const { history, subsChains } = correr({ ...base, mercadopago_preapproval_at: hace(2) }, 0)

    const body = await (await GET(new Request("http://localhost/api/cron/subscription-sweep"))).json()

    expect(body.results.markedPastDue).toBe(0)
    expect(history.insert).not.toHaveBeenCalled()
    expect(subsChains.some((c) => c.update.mock.calls.length > 0)).toBe(false)
  })

  it("fila anterior a la columna: mide desde created_at, como antes", async () => {
    const { pagos } = correr({ ...base, mercadopago_preapproval_at: null }, 0)

    await GET(new Request("http://localhost/api/cron/subscription-sweep"))

    expect(pagos.gte).toHaveBeenCalledWith("paid_at", base.created_at)
  })
})
