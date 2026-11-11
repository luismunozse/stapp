import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { rateLimit } = vi.hoisted(() => ({ rateLimit: vi.fn() }))
vi.mock("@/lib/rate-limit", () => ({ rateLimit }))

import { checkSuperadminLoginLimit } from "@/lib/superadmin-login-limit-edge"

describe("checkSuperadminLoginLimit", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.invalid")
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    rateLimit.mockResolvedValue({ success: true, limit: 10, remaining: 9, reset: 0 })
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("llama al RPC compartido y traduce la respuesta", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ allowed: false, count: 10, reset: 2_000_000_000 })))
    const r = await checkSuperadminLoginLimit("1.2.3.4", 10, 600)
    expect(r).toEqual({ success: false, limit: 10, remaining: 0, reset: 2_000_000_000_000 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://db.invalid/rest/v1/rpc/check_superadmin_rate_limit")
    expect(JSON.parse(init.body)).toEqual({
      p_identifier: "ip:1.2.3.4",
      p_endpoint: "superadmin:login",
      p_max_requests: 10,
      p_window_seconds: 600,
    })
    expect(rateLimit).not.toHaveBeenCalled()
  })

  it.each([
    ["la base da error", () => fetchMock.mockResolvedValue(new Response("boom", { status: 500 }))],
    ["el fetch falla", () => fetchMock.mockRejectedValue(new Error("network"))],
    ["la respuesta no tiene allowed", () => fetchMock.mockResolvedValue(new Response("{}"))],
  ])("si %s cae al límite en memoria (nunca deja de limitar)", async (_caso, preparar) => {
    preparar()
    rateLimit.mockResolvedValue({ success: false, limit: 10, remaining: 0, reset: 1 })
    const r = await checkSuperadminLoginLimit("1.2.3.4", 10, 600)
    expect(r.success).toBe(false)
    expect(rateLimit).toHaveBeenCalledWith("ip:1.2.3.4:superadmin:login", 10, 600_000)
  })

  it("sin credenciales de la base usa el límite en memoria", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "")
    await checkSuperadminLoginLimit("1.2.3.4", 10, 600)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(rateLimit).toHaveBeenCalled()
  })
})
