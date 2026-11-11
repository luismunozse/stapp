import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { GET } from "@/app/api/cron/catalogo-pii-purge/route"

const req = () => new Request("http://localhost/api/cron/catalogo-pii-purge", { headers: { authorization: "Bearer s3cret" } })

describe("GET /api/cron/catalogo-pii-purge", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("CRON_SECRET", "s3cret")
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ok: true }, error: null } as never)
    vi.mocked(supabaseAdmin.from).mockReturnValue({
      delete: () => ({ lt: () => Promise.resolve({ error: null }) }),
    } as never)
  })

  it("rejects requests without the cron secret", async () => {
    const res = await GET(new Request("http://localhost/x"))
    expect(res.status).toBe(401)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("purges PII and also sweeps expired rate-limit buckets", async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    const names = vi.mocked(supabaseAdmin.rpc).mock.calls.map((c) => c[0])
    expect(names).toEqual(["purgar_pii_catalogo_publico", "limpiar_rate_limit_buckets"])
  })

  it("a failing bucket sweep does not turn the PII purge into a 500", async () => {
    vi.mocked(supabaseAdmin.rpc)
      .mockResolvedValueOnce({ data: { ok: true }, error: null } as never)
      .mockResolvedValueOnce({ data: null, error: { message: "no existe" } } as never)
    const res = await GET(req())
    expect(res.status).toBe(200)
  })

  it("500 when the PII purge itself fails", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({ data: null, error: { message: "boom" } } as never)
    const res = await GET(req())
    expect(res.status).toBe(500)
  })

  it("borra los contadores de login vencidos hace más de un día, sin romper si falla", async () => {
    const lt = vi.fn().mockResolvedValue({ error: { message: "boom" } })
    const del = vi.fn(() => ({ lt }))
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce({ delete: del } as never)
    const antes = Date.now()
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(supabaseAdmin.from).toHaveBeenCalledWith("superadmin_rate_limits")
    expect(del).toHaveBeenCalled()
    const [col, corte] = lt.mock.calls[0] as unknown as [string, string]
    expect(col).toBe("window_end")
    expect(antes - Date.parse(corte)).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000)
  })
})
