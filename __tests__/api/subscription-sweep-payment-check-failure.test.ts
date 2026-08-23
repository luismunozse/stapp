import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createChainMock } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/cron-auth", () => ({
  requireCronAuth: vi.fn(() => null),
}))

import { GET } from "@/app/api/cron/subscription-sweep/route"

/**
 * Si la consulta que cuenta pagos exitosos falla (red, base caida), el conteo
 * viene null. Leer eso como "cero pagos" marca PAST_DUE a un taller que si
 * esta pagando: el modo de falla exacto que esta funcionalidad existe para
 * evitar. Ante un error de infraestructura no se bloquea a nadie: se saltea
 * la organizacion y se cuenta como failed.
 */
const AHORA_ISO = "2026-08-22T12:00:00.000Z"

function hace(dias: number) {
  const d = new Date(AHORA_ISO)
  d.setDate(d.getDate() - dias)
  return d.toISOString()
}

const ADHESION_VIEJA_SIN_COBRO = {
  id: "sub-1",
  organization_id: "org-1",
  created_at: hace(20),
  current_period_end: null,
  mercadopago_preapproval_id: "preap-1",
  organizations: { slug: "taller-test" },
  plans: { tipo: "PREMIUM" },
}

describe("GET /api/cron/subscription-sweep — falla la consulta de pagos exitosos", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(AHORA_ISO))
  })

  afterEach(() => vi.useRealTimers())

  it("no marca PAST_DUE a la adhesion: ante la duda, no se bloquea a quien puede estar pagando", async () => {
    let subscriptionsCallCount = 0
    const subscriptionsChains: any[] = []
    const historyChain = createChainMock(null, null)
    // La consulta de pagos exitosos falla (error de infraestructura, no "cero pagos").
    const pagosErrorChain = createChainMock(null, { message: "conexion perdida" })
    const plansChain = createChainMock({ id: "plan-free-1" })

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "plans") return plansChain as any
      if (table === "subscription_payments") return pagosErrorChain as any
      if (table === "subscription_history") return historyChain as any
      if (table === "subscriptions") {
        subscriptionsCallCount++
        // 1ra llamada: pasada de "expired" (vacia). 2da: pasada de adhesiones
        // (nuestra fila). 3ra en adelante: pasada TRIALING limbo (vacia) y/o
        // cualquier update() que dispare el codigo sin arreglar.
        const data = subscriptionsCallCount === 2 ? [ADHESION_VIEJA_SIN_COBRO] : []
        const chain = createChainMock(data)
        subscriptionsChains.push(chain)
        return chain as any
      }
      return createChainMock(null) as any
    })

    const res = await GET(
      new Request("http://localhost/api/cron/subscription-sweep")
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.results.markedPastDue).toBe(0)
    expect(body.results.failed).toBe(1)

    // Ni el UPDATE a PAST_DUE ni el insert en subscription_history debieron
    // dispararse para esta adhesion: la organizacion queda intacta.
    expect(historyChain.insert).not.toHaveBeenCalled()
    const seUpdateoAlgunaSuscripcion = subscriptionsChains.some(
      (chain) => chain.update.mock.calls.length > 0
    )
    expect(seUpdateoAlgunaSuscripcion).toBe(false)
  })
})
