import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"

// El poll de estado NO debe crear filas en sucursal_whatsapp_config: una fila
// con instance_name implica que la instancia existe en Evolution, y eso solo
// lo garantiza el POST /connect (createInstance). Ver health.ts (indeterminadas).
vi.mock("@/lib/whatsapp/providers/evolution", () => ({
  getConnectionState: vi.fn(),
  connectInstance: vi.fn(),
}))
vi.mock("@/lib/whatsapp/sucursal-config", () => ({
  upsertSucursalWhatsAppState: vi.fn(),
  updateSucursalWhatsAppState: vi.fn(),
}))
vi.mock("@/lib/subscriptions", () => ({ hasPlanFeature: vi.fn() }))

import { getConnectionState, connectInstance } from "@/lib/whatsapp/providers/evolution"
import { upsertSucursalWhatsAppState, updateSucursalWhatsAppState } from "@/lib/whatsapp/sucursal-config"
import { hasPlanFeature } from "@/lib/subscriptions"
import { GET, POST } from "@/app/api/sucursales/[id]/whatsapp/qr/route"

const params = Promise.resolve({ id: "suc-1" })
const req = new Request("http://localhost:3000/api/sucursales/suc-1/whatsapp/qr")

describe("/api/sucursales/[id]/whatsapp/qr", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("EVOLUTION_BASE_URL", "https://evo.stapp.com.ar")
    vi.stubEnv("EVOLUTION_API_KEY", "platform-key")
    mockAuthSuccess({ organizationId: "org-1" })
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    mockSupabaseFrom({ sucursales: createChainMock({ id: "suc-1" }) })
  })
  afterEach(() => vi.unstubAllEnvs())

  it("GET (poll) actualiza estado sin crear filas", async () => {
    vi.mocked(getConnectionState).mockResolvedValue({ state: "unknown", error: "HTTP 404" } as any)
    const res = await GET(req, { params })
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.state).toBe("unknown")
    expect(updateSucursalWhatsAppState).toHaveBeenCalledWith("org-1", "suc-1", "unknown")
    expect(upsertSucursalWhatsAppState).not.toHaveBeenCalled()
  })

  it("POST (regenerar QR) actualiza estado sin crear filas", async () => {
    vi.mocked(connectInstance).mockResolvedValue({ state: "qr", qrBase64: "data:image/png;base64,x" } as any)
    const res = await POST(req, { params })
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.state).toBe("qr")
    expect(updateSucursalWhatsAppState).toHaveBeenCalledWith("org-1", "suc-1", "qr", { qr: true })
    expect(upsertSucursalWhatsAppState).not.toHaveBeenCalled()
  })
})
