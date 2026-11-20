// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"
import { createChainMock, mockAuthSuccess, mockSupabaseFrom, parseResponse } from "./helpers"

const createCreemCheckout = vi.fn()
vi.mock("@/lib/creem", () => ({
  verifyCreemSignature: vi.fn(() => true),
  createCreemCheckout: (...args: unknown[]) => createCreemCheckout(...args),
}))
vi.mock("@/lib/webhook-log", () => ({
  beginWebhookEvent: vi.fn().mockResolvedValue(null),
  finishWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

import { POST as webhook } from "@/app/api/creem/webhook/route"
import { POST as checkout } from "@/app/api/creem/checkout/route"

// Caso real (2026-11-19): una suscripción creada con la key de sandbox de Creem
// renovaba todos los meses el plan de una organización real sin cobrar nada.
const evento = (eventType: string, mode: "test" | "live" | undefined) =>
  new NextRequest("http://localhost/api/creem/webhook", {
    method: "POST",
    headers: { "creem-signature": "ok" },
    body: JSON.stringify({
      id: "evt1",
      eventType,
      object: {
        id: "sub1",
        ...(mode ? { mode } : {}),
        metadata: { organization_id: "o1", plan_slug: "profesional", billing_period: "MONTHLY" },
        product: { id: "p1", price: 1400, currency: "USD" },
        current_period_end_date: "2026-12-19T22:13:48.529Z",
      },
    }),
  })

function mockTablas() {
  const subscriptions = createChainMock({ id: "s1" }, null)
  const pagos = createChainMock(null, null)
  mockSupabaseFrom({
    organizations: createChainMock({ id: "o1", deleted_at: null, activo: true }, null),
    subscriptions,
    subscription_payments: pagos,
    plans: createChainMock({ id: "plan1", slug: "profesional", creem_product_id_monthly: "p1" }, null),
  })
  return { subscriptions, pagos }
}

const produccion = () => {
  vi.stubEnv("NODE_ENV", "production")
  vi.stubEnv("VERCEL_ENV", "production")
}

describe("webhook de Creem: eventos de sandbox", () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllEnvs())

  it.each([
    "checkout.completed",
    "subscription.active",
    "subscription.paid",
    "subscription.canceled",
    "subscription.expired",
    "refund.created",
    "dispute.created",
  ])("en producción %s en modo test se ignora y no toca la base", async (tipo) => {
    produccion()
    const { subscriptions, pagos } = mockTablas()

    const { status, body } = await parseResponse(await webhook(evento(tipo, "test")))

    expect(status).toBe(200)
    expect(body.result).toEqual({ status: "SKIPPED", reason: "creem_test_mode_event" })
    expect(subscriptions.upsert).not.toHaveBeenCalled()
    expect(subscriptions.update).not.toHaveBeenCalled()
    expect(pagos.insert).not.toHaveBeenCalled()
  })

  it("en producción un evento real (sin modo test) se procesa", async () => {
    produccion()
    const { subscriptions } = mockTablas()

    const { status } = await parseResponse(await webhook(evento("subscription.paid", "live")))

    expect(status).toBe(200)
    expect(subscriptions.upsert).toHaveBeenCalled()
  })

  it("en un deploy de preview el modo test se procesa (sirve para probar)", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("VERCEL_ENV", "preview")
    const { subscriptions } = mockTablas()

    await webhook(evento("subscription.paid", "test"))

    expect(subscriptions.upsert).toHaveBeenCalled()
  })

  it("en desarrollo el modo test se procesa", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("VERCEL_ENV", "")
    const { subscriptions } = mockTablas()

    await webhook(evento("subscription.paid", "test"))

    expect(subscriptions.upsert).toHaveBeenCalled()
  })
})

describe("checkout de Creem con key de sandbox", () => {
  const pedir = () =>
    checkout(
      new NextRequest("http://localhost/api/creem/checkout", {
        method: "POST",
        body: JSON.stringify({ billingPeriod: "MONTHLY" }),
      })
    )

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ organizationId: "o1" })
    mockTablas()
    createCreemCheckout.mockResolvedValue({ checkoutUrl: "https://creem.io/c/1" })
  })
  afterEach(() => vi.unstubAllEnvs())

  it("en producción no crea el checkout: se pagaría con tarjeta de prueba", async () => {
    produccion()
    vi.stubEnv("CREEM_API_KEY", "creem_test_abc")

    const { status } = await parseResponse(await pedir())

    expect(status).toBe(503)
    expect(createCreemCheckout).not.toHaveBeenCalled()
  })

  it("en producción con key real crea el checkout", async () => {
    produccion()
    vi.stubEnv("CREEM_API_KEY", "creem_abc")

    const { status, body } = await parseResponse(await pedir())

    expect(status).toBe(200)
    expect(body.checkoutUrl).toBe("https://creem.io/c/1")
  })

  it("fuera de producción la key de sandbox sigue funcionando", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("VERCEL_ENV", "")
    vi.stubEnv("CREEM_API_KEY", "creem_test_abc")

    const { status } = await parseResponse(await pedir())

    expect(status).toBe(200)
  })
})
