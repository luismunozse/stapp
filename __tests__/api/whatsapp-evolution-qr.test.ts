import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"

vi.mock("@/lib/whatsapp/providers/evolution", () => ({
  getConnectionState: vi.fn(),
  connectInstance: vi.fn(),
}))
import { getConnectionState, connectInstance } from "@/lib/whatsapp/providers/evolution"
import { GET } from "@/app/api/whatsapp/evolution/qr/route"

const req = (url = "https://app.stapp.com.ar/api/whatsapp/evolution/qr") => new Request(url)

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
    const res = await GET(req())
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.state).toBe("open")
    expect(orgChain.update).toHaveBeenCalledWith({ notificaciones_whatsapp: true })
    expect(orgChain.eq).toHaveBeenCalledWith("id", "org-1")
  })

  it("does NOT touch organizations when state is not open", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    vi.mocked(getConnectionState).mockResolvedValue({ state: "connecting" } as any)
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(orgChain.update).not.toHaveBeenCalled()
  })
})

describe("GET /api/whatsapp/evolution/qr — QR fresco (fix del QR congelado)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("EVOLUTION_BASE_URL", "https://evo.stapp.com.ar")
    vi.stubEnv("EVOLUTION_API_KEY", "platform-key")
    mockSupabaseFrom({
      whatsapp_config: createChainMock({ provider: "evolution", evolution_instance_name: "stapp-org-org-1" }),
      organizations: createChainMock(null),
    })
    mockAuthSuccess({ organizationId: "org-1" })
  })
  afterEach(() => vi.unstubAllEnvs())

  it("devuelve un QR nuevo cuando se pide refresh y la instancia sigue sin vincular", async () => {
    vi.mocked(getConnectionState).mockResolvedValue({ state: "connecting" } as any)
    vi.mocked(connectInstance).mockResolvedValue({
      state: "qr",
      qrBase64: "data:image/png;base64,QR-FRESCO",
      pairingCode: "ABCD-1234",
    } as any)

    const res = await GET(req("https://app.stapp.com.ar/api/whatsapp/evolution/qr?refresh=1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(connectInstance).toHaveBeenCalledTimes(1)
    expect(body.qrBase64).toBe("data:image/png;base64,QR-FRESCO")
    expect(body.pairingCode).toBe("ABCD-1234")
  })

  it("no pide QR nuevo si la instancia ya esta vinculada", async () => {
    vi.mocked(getConnectionState).mockResolvedValue({ state: "open" } as any)

    const res = await GET(req("https://app.stapp.com.ar/api/whatsapp/evolution/qr?refresh=1"))
    const { body } = await parseResponse(res)

    expect(connectInstance).not.toHaveBeenCalled()
    expect(body.state).toBe("open")
    expect(body.qrBase64).toBeNull()
  })

  it("el poll de estado sin refresh no golpea /instance/connect", async () => {
    vi.mocked(getConnectionState).mockResolvedValue({ state: "connecting" } as any)

    const res = await GET(req())
    const { body } = await parseResponse(res)

    expect(connectInstance).not.toHaveBeenCalled()
    expect(body.state).toBe("connecting")
  })
})
