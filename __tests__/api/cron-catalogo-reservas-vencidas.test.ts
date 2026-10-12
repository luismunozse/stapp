import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { GET } from "@/app/api/cron/catalogo-reservas-vencidas/route"

const req = (auth = "Bearer s3cret") =>
  new Request("http://localhost/api/cron/catalogo-reservas-vencidas", { headers: { authorization: auth } })

const lote = (revisadas: number) => ({
  data: { ok: true, revisadas, liberadas: revisadas, itemsLiberados: revisadas, itemsCatalogoRestaurados: 0 },
  error: null,
})

describe("GET /api/cron/catalogo-reservas-vencidas", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("CRON_SECRET", "s3cret")
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("rejects requests without the cron secret and does not touch the DB", async () => {
    const res = await GET(req("Bearer otro"))
    expect(res.status).toBe(401)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("calls expirar_reservas_catalogo once when the batch is not full", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue(lote(3) as never)
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(1)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("expirar_reservas_catalogo", { p_limite: 200 })
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, lotes: 1, revisadas: 3 })
  })

  it("keeps draining while batches come back full, up to a cap", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue(lote(200) as never)
    const res = await GET(req())
    expect(res.status).toBe(200)
    const n = vi.mocked(supabaseAdmin.rpc).mock.calls.length
    expect(n).toBeGreaterThan(1)
    expect(n).toBeLessThanOrEqual(5)
  })

  it("500 when the RPC fails", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { message: "boom" } } as never)
    const res = await GET(req())
    expect(res.status).toBe(500)
  })
})
