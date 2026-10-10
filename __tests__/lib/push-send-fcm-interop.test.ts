/**
 * Tests: firebase-admin ESM/CJS interop in lib/push/send.ts.
 *
 * Depending on the runtime, `import("firebase-admin")` exposes the API either
 * on the namespace itself (CJS-style) or under `.default` (ESM interop). The
 * sender must work with both shapes, as getWebPush() already does.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const send = vi.fn().mockResolvedValue("msg-id")
const initializeApp = vi.fn()

function makeAdmin() {
  return {
    apps: [] as unknown[],
    initializeApp,
    credential: { cert: vi.fn((c: unknown) => c) },
    messaging: () => ({ send }),
  }
}

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const rows =
        table === "push_tokens" ? [{ id: "t1", token: "tok", platform: "android" }] : []
      const chain = {
        select: () => chain,
        eq: (col: string) => (col === "active" ? Promise.resolve({ data: rows }) : chain),
      }
      return chain
    },
  },
}))

async function loadSendWith(shape: "default" | "namespace") {
  vi.resetModules()
  process.env.FCM_SERVICE_ACCOUNT = JSON.stringify({ project_id: "p" })
  const admin = makeAdmin()
  vi.doMock("firebase-admin", () =>
    // vitest throws on access to a missing `default` of a mocked module, so the
    // namespace shape declares it explicitly as undefined.
    shape === "default" ? { default: admin } : { ...admin, default: undefined }
  )
  return import("@/lib/push/send")
}

describe("sendPushToUser: firebase-admin interop", () => {
  beforeEach(() => {
    send.mockClear()
    initializeApp.mockClear()
  })

  it("works when exports live under .default", async () => {
    const { sendPushToUser } = await loadSendWith("default")
    const res = await sendPushToUser("u1", { title: "t", body: "b" })
    expect(res.byTransport.fcm).toBe(1)
    expect(res.errors).toEqual([])
    expect(initializeApp).toHaveBeenCalledTimes(1)
  })

  it("works when exports live on the namespace", async () => {
    const { sendPushToUser } = await loadSendWith("namespace")
    const res = await sendPushToUser("u1", { title: "t", body: "b" })
    expect(res.byTransport.fcm).toBe(1)
    expect(res.errors).toEqual([])
  })
})
