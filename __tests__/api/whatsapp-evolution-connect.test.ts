import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({ hasPlanFeature: vi.fn() }))
vi.mock("@/lib/whatsapp/providers/evolution", () => ({
  createInstance: vi.fn(),
  connectInstance: vi.fn(),
}))

import { hasPlanFeature } from "@/lib/subscriptions"
import { createInstance, connectInstance } from "@/lib/whatsapp/providers/evolution"
import { POST } from "@/app/api/whatsapp/evolution/connect/route"

describe("POST /api/whatsapp/evolution/connect", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("EVOLUTION_BASE_URL", "https://evo.stapp.com.ar")
    vi.stubEnv("EVOLUTION_API_KEY", "platform-key")
    mockSupabaseFrom({ whatsapp_config: createChainMock(null) })
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    vi.mocked(createInstance).mockResolvedValue({ success: true, alreadyExists: false } as any)
    vi.mocked(connectInstance).mockResolvedValue({ state: "connecting", qrBase64: "data:image/png;base64,AAA", pairingCode: "1234" } as any)
  })
  afterEach(() => vi.unstubAllEnvs())

  it("returns 403 without the plan feature", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    vi.mocked(hasPlanFeature).mockResolvedValue(false)
    const res = await POST()
    expect(res.status).toBe(403)
  })

  it("returns 503 when platform env is missing", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    vi.stubEnv("EVOLUTION_BASE_URL", "")
    const res = await POST()
    expect(res.status).toBe(503)
  })

  it("creates the instance with stapp-org-{id} and returns the QR", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    const res = await POST()
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.qrBase64).toContain("base64")
    expect(body.state).toBe("connecting")
    const credsArg = vi.mocked(createInstance).mock.calls[0][0]
    expect(credsArg).toEqual({
      baseUrl: "https://evo.stapp.com.ar",
      instanceName: "stapp-org-org-1",
      apiKey: "platform-key",
    })
  })

  it("returns 502 when createInstance fails", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    vi.mocked(createInstance).mockResolvedValue({ success: false, error: "boom" } as any)
    const res = await POST()
    expect(res.status).toBe(502)
    expect(connectInstance).not.toHaveBeenCalled()
  })
})
