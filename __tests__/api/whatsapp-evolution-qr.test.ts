import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"

vi.mock("@/lib/whatsapp/providers/evolution", () => ({ getConnectionState: vi.fn() }))
import { getConnectionState } from "@/lib/whatsapp/providers/evolution"
import { GET } from "@/app/api/whatsapp/evolution/qr/route"

describe("GET /api/whatsapp/evolution/qr (poll)", () => {
  let orgChain: ReturnType<typeof createChainMock>
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("EVOLUTION_BASE_URL", "https://evo.stapp.com.ar")
    vi.stubEnv("EVOLUTION_API_KEY", "platform-key")
    orgChain = createChainMock(null)
    mockSupabaseFrom({
      whatsapp_config: createChainMock({ provider: "evolution", evolution_instance_name: "stapp-org-org-1" }),
      organizations: orgChain,
    })
  })
  afterEach(() => vi.unstubAllEnvs())

  it("enables notificaciones_whatsapp with correct payload+scope when state is open", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    vi.mocked(getConnectionState).mockResolvedValue({ state: "open" } as any)
    const res = await GET()
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.state).toBe("open")
    expect(orgChain.update).toHaveBeenCalledWith({ notificaciones_whatsapp: true })
    expect(orgChain.eq).toHaveBeenCalledWith("id", "org-1")
  })

  it("does NOT touch organizations when state is not open", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    vi.mocked(getConnectionState).mockResolvedValue({ state: "connecting" } as any)
    const res = await GET()
    expect(res.status).toBe(200)
    expect(orgChain.update).not.toHaveBeenCalled()
  })
})
