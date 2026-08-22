import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createChainMock, mockSupabaseFrom } from "./helpers"

import { handlePaymentNotification } from "@/app/api/mercadopago/webhook/route"

/**
 * MercadoPago manda varias notificaciones del MISMO pago casi simultáneas. El
 * chequeo de idempotencia por SELECT no alcanza: las tres leen antes de que
 * alguna commitee y las tres insertan.
 *
 * Con el UNIQUE de la migración 305, la carrera la corta la base. Lo que fija
 * este test es qué hace el handler cuando pierde esa carrera: reconocer que el
 * pago ya estaba registrado y NO volver a tocar la suscripción. Sin eso, la
 * notificación duplicada apila otro mes de servicio sobre uno solo cobrado.
 */
const PAGO_APROBADO = {
  id: 174586824094,
  status: "approved",
  transaction_amount: 19999,
  currency_id: "ARS",
  date_approved: "2026-08-19T13:31:18.000Z",
  external_reference: JSON.stringify({ organization_id: "org-1", plan_slug: "profesional" }),
  payer: { id: 123 },
}

describe("handlePaymentNotification — notificación duplicada del mismo pago", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify(PAGO_APROBADO), { status: 200 })
    ) as any
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mockTablas() {
    const subscriptions = createChainMock(null, null)
    // El SELECT de idempotencia no encuentra nada (la fila de la otra
    // notificación todavía no commiteó) y el INSERT choca contra el UNIQUE.
    const pagos = createChainMock(null, { code: "23505", message: "duplicate key value" })

    mockSupabaseFrom({
      organizations: createChainMock({ id: "org-1", activo: true }),
      subscription_payments: pagos,
      plans: createChainMock({ id: "plan-1", slug: "profesional" }),
      subscriptions,
    })

    return { subscriptions, pagos }
  }

  it("reconoce el pago ya registrado en vez de explotar", async () => {
    mockTablas()

    const r = await handlePaymentNotification("174586824094")

    expect(r.status).toBe("SKIPPED")
    expect(r.reason).toBe("already_processed")
  })

  it("NO vuelve a tocar la suscripción: ahí es donde se apilaba el mes de más", async () => {
    const { subscriptions } = mockTablas()

    await handlePaymentNotification("174586824094")

    expect(subscriptions.upsert).not.toHaveBeenCalled()
  })
})
