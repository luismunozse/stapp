// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("@/lib/creem", () => ({ verifyCreemSignature: vi.fn(() => true) }))
vi.mock("@/lib/webhook-log", () => ({
  beginWebhookEvent: vi.fn().mockResolvedValue(null),
  finishWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from "@/app/api/creem/webhook/route"

const evento = (eventType: string) =>
  new NextRequest("http://localhost/api/creem/webhook", {
    method: "POST",
    headers: { "creem-signature": "ok" },
    body: JSON.stringify({
      id: "evt1",
      eventType,
      object: { id: "sub1", metadata: { organization_id: "o1", plan_slug: "profesional" }, product: { id: "p1" } },
    }),
  })

describe("webhook de Creem con la organización dada de baja", () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(["subscription.active", "subscription.paid", "checkout.completed"])(
    "%s: responde 200 SKIPPED y no toca subscriptions (antes: FK -> 500 -> reintento infinito)",
    async (tipo) => {
      const subscriptions = createChainMock(null, null)
      mockSupabaseFrom({
        organizations: createChainMock(null, null), // org purgada
        subscriptions,
        plans: createChainMock({ id: "plan1", slug: "profesional" }, null),
      })
      const { status, body } = await parseResponse(await POST(evento(tipo)))
      expect(status).toBe(200)
      expect(body.result.status).toBe("SKIPPED")
      expect(body.result.reason).toBe("org_deleted_or_missing")
      expect(subscriptions.upsert).not.toHaveBeenCalled()
    }
  )
})
