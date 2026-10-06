import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { rateLimitDb } from "@/lib/rate-limit-db"

describe("rateLimitDb", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("allows when the RPC says true and forwards the arguments", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: true, error: null } as never)
    await expect(rateLimitDb("k", 5, 600)).resolves.toBe(true)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("rate_limit_hit", {
      p_key: "k",
      p_max: 5,
      p_window_seconds: 600,
    })
  })

  it("blocks when the RPC says false", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: false, error: null } as never)
    await expect(rateLimitDb("k", 5, 600)).resolves.toBe(false)
  })

  it("fails open on a DB error and logs it", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { message: "boom" } } as never)
    await expect(rateLimitDb("k", 5, 600)).resolves.toBe(true)
    expect(console.error).toHaveBeenCalled()
  })

  it("fails open when the RPC throws", async () => {
    vi.mocked(supabaseAdmin.rpc).mockRejectedValue(new Error("network"))
    await expect(rateLimitDb("k", 5, 600)).resolves.toBe(true)
  })

  it("fails open when the RPC returns a non-boolean (function missing / not applied)", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: null } as never)
    await expect(rateLimitDb("k", 5, 600)).resolves.toBe(true)
  })
})
