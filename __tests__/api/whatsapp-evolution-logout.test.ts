import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock } from "./helpers"

vi.mock("@/lib/whatsapp/providers/evolution", () => ({ logoutInstance: vi.fn() }))
import { logoutInstance } from "@/lib/whatsapp/providers/evolution"
import { POST } from "@/app/api/whatsapp/evolution/logout/route"

describe("POST /api/whatsapp/evolution/logout", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("EVOLUTION_BASE_URL", "https://evo.stapp.com.ar")
    vi.stubEnv("EVOLUTION_API_KEY", "platform-key")
    vi.mocked(logoutInstance).mockResolvedValue({ success: true } as any)
  })
  afterEach(() => vi.unstubAllEnvs())

  it("disconnects and turns notificaciones_whatsapp off (asserts payload + scope)", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    const orgChain = createChainMock(null)
    mockSupabaseFrom({ whatsapp_config: createChainMock(null), organizations: orgChain })

    const res = await POST()
    expect(res.status).toBe(200)
    expect(orgChain.update).toHaveBeenCalledWith({ notificaciones_whatsapp: false })
    expect(orgChain.eq).toHaveBeenCalledWith("id", "org-1")

    const credsArg = vi.mocked(logoutInstance).mock.calls[0][0]
    expect(credsArg.instanceName).toBe("stapp-org-org-1")
    expect(credsArg.baseUrl).toBe("https://evo.stapp.com.ar")
  })

  it("returns 503 when platform env is missing", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    vi.stubEnv("EVOLUTION_BASE_URL", "")
    mockSupabaseFrom({ whatsapp_config: createChainMock(null), organizations: createChainMock(null) })
    const res = await POST()
    expect(res.status).toBe(503)
    expect(vi.mocked(logoutInstance)).not.toHaveBeenCalled()
  })
})
