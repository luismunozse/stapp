// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("@/lib/webhook-log", () => ({
  beginWebhookEvent: vi.fn().mockResolvedValue(null),
  finishWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from "@/app/api/rebill/webhook/route"
import { finishWebhookEvent } from "@/lib/webhook-log"

const evento = (event: string, data: Record<string, unknown>) =>
  new NextRequest("http://localhost/api/rebill/webhook", {
    method: "POST",
    body: JSON.stringify({ event, data }),
  })

const pago = {
  id: "pay1",
  status: "approved",
  amount: 10,
  metadata: { organization_id: "o1", plan_slug: "profesional" },
}

describe("webhook de Rebill con la organización dada de baja", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.REBILL_WEBHOOK_TOKEN
  })

  it("payment.created en período de gracia: 200, SKIPPED y no registra pago ni reactiva", async () => {
    const subscriptions = createChainMock(null, null)
    const pagos = createChainMock(null, null)
    mockSupabaseFrom({
      organizations: createChainMock({ id: "o1", activo: true, deleted_at: "2026-10-05T00:00:00Z" }, null),
      subscriptions,
      subscription_payments: pagos,
      plans: createChainMock({ id: "plan1", slug: "profesional" }, null),
    })
    const { status } = await parseResponse(await POST(evento("payment.created", pago)))
    expect(status).toBe(200)
    expect(finishWebhookEvent).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ status: "SKIPPED", httpStatus: 200, errorMessage: "org_not_found_or_inactive" })
    )
    expect(subscriptions.upsert).not.toHaveBeenCalled()
    expect(subscriptions.update).not.toHaveBeenCalled()
    expect(pagos.insert).not.toHaveBeenCalled()
  })

  it("subscription.updated con la org purgada: 200, SKIPPED y no toca subscriptions", async () => {
    const subscriptions = createChainMock(null, null)
    mockSupabaseFrom({ organizations: createChainMock(null, null), subscriptions })
    const { status } = await parseResponse(
      await POST(
        evento("subscription.updated", {
          id: "s1",
          status: "active",
          metadata: { organization_id: "o1" },
        })
      )
    )
    expect(status).toBe(200)
    expect(finishWebhookEvent).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ status: "SKIPPED", httpStatus: 200, errorMessage: "org_deleted_or_missing" })
    )
    expect(subscriptions.update).not.toHaveBeenCalled()
  })
})
