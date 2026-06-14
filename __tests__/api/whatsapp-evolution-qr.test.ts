import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/whatsapp/providers/evolution", () => ({ getConnectionState: vi.fn() }))
import { getConnectionState } from "@/lib/whatsapp/providers/evolution"
import { GET } from "@/app/api/whatsapp/evolution/qr/route"

describe("GET /api/whatsapp/evolution/qr (poll)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("EVOLUTION_BASE_URL", "https://evo.stapp.com.ar")
    vi.stubEnv("EVOLUTION_API_KEY", "platform-key")
    mockSupabaseFrom({
      whatsapp_config: createChainMock({ provider: "evolution", evolution_instance_name: "stapp-org-org-1" }),
      organizations: createChainMock(null),
    })
  })
  afterEach(() => vi.unstubAllEnvs())

  it("enables notificaciones_whatsapp when state becomes open", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    vi.mocked(getConnectionState).mockResolvedValue({ state: "open" } as any)
    const res = await GET()
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.state).toBe("open")
    const orgUpdate = vi.mocked(supabaseAdmin.from).mock.calls.some((c) => c[0] === "organizations")
    expect(orgUpdate).toBe(true)
  })

  it("does NOT enable notifications when state is not open", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    vi.mocked(getConnectionState).mockResolvedValue({ state: "connecting" } as any)
    const res = await GET()
    expect(res.status).toBe(200)
    const orgUpdate = vi.mocked(supabaseAdmin.from).mock.calls.some((c) => c[0] === "organizations")
    expect(orgUpdate).toBe(false)
  })
})
