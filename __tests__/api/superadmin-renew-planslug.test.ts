import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("@/lib/superadmin-auth", () => ({
  requireSuperadmin: vi.fn().mockResolvedValue({ error: null, email: "admin@stapp.com.ar" }),
}))

import { POST } from "@/app/api/superadmin/subscriptions/renew/route"

function postJson(body: unknown): Request {
  return new Request("http://localhost/api/superadmin/subscriptions/renew", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/superadmin/subscriptions/renew — planSlug", () => {
  beforeEach(() => vi.clearAllMocks())

  it("resolves the plan by the provided planSlug", async () => {
    // plans chain: select().eq("slug","pro").eq("activo",true).maybeSingle() → plan data
    const plansChain = createChainMock({
      id: "plan-pro",
      slug: "pro",
      precio_mensual: 9900,
      precio_anual: 99000,
      moneda: "ARS",
    })

    // subscriptions is queried TWICE:
    //   1st call: .select(...).eq("organization_id",...).single() → null (no existing sub)
    //   2nd call: .insert({...}).select("id").single() → { id: "s1" }
    // Build the chain as a plain object first to avoid TDZ self-reference.
    let subsSelectCallCount = 0
    const subsChain: any = {}
    subsChain.select = vi.fn().mockReturnValue(subsChain)
    subsChain.eq = vi.fn().mockReturnValue(subsChain)
    subsChain.neq = vi.fn().mockReturnValue(subsChain)
    subsChain.insert = vi.fn().mockReturnValue(subsChain)
    subsChain.single = vi.fn().mockImplementation(() => {
      subsSelectCallCount++
      if (subsSelectCallCount === 1) {
        // First call: no existing subscription
        return Promise.resolve({ data: null, error: null })
      }
      // Second call: after insert().select("id")
      return Promise.resolve({ data: { id: "s1" }, error: null })
    })
    // Make thenable so awaiting the chain directly also resolves
    subsChain.then = (resolve: any, reject?: any) =>
      Promise.resolve({ data: null, error: null }).then(resolve, reject)
    subsChain.catch = (reject: any) =>
      Promise.resolve({ data: null, error: null }).catch(reject)

    mockSupabaseFrom({
      plans: plansChain,
      subscriptions: subsChain,
      subscription_payments: createChainMock(null),
      subscription_history: createChainMock(null),
      audit_logs: createChainMock(null),
      users: createChainMock([]),
      user_notifications: createChainMock(null),
    })

    const res = await POST(postJson({ organizationId: "o1", planSlug: "pro", billingPeriod: "MONTHLY" }))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    // Handler: targetSlug = planSlug || "profesional", then .eq("slug", targetSlug)
    expect(plansChain.eq).toHaveBeenCalledWith("slug", "pro")
  })
})
