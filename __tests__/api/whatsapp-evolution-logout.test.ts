import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/whatsapp/providers/evolution", () => ({ logoutInstance: vi.fn() }))
import { logoutInstance } from "@/lib/whatsapp/providers/evolution"
import { POST } from "@/app/api/whatsapp/evolution/logout/route"

describe("POST /api/whatsapp/evolution/logout", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("EVOLUTION_BASE_URL", "https://evo.stapp.com.ar")
    vi.stubEnv("EVOLUTION_API_KEY", "platform-key")
    mockSupabaseFrom({
      whatsapp_config: createChainMock(null),
      organizations: createChainMock(null),
    })
    vi.mocked(logoutInstance).mockResolvedValue({ success: true } as any)
  })
  afterEach(() => vi.unstubAllEnvs())

  it("disconnects and turns notificaciones_whatsapp off", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    const res = await POST()
    expect(res.status).toBe(200)
    const orgUpdate = vi.mocked(supabaseAdmin.from).mock.calls.some((c) => c[0] === "organizations")
    expect(orgUpdate).toBe(true)
    const credsArg = vi.mocked(logoutInstance).mock.calls[0][0]
    expect(credsArg.instanceName).toBe("stapp-org-org-1")
    expect(credsArg.baseUrl).toBe("https://evo.stapp.com.ar")
  })
})
