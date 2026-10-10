import { describe, it, expect, vi, beforeEach } from "vitest"
import { getUserDeletedStatus, clearUserStatusCache } from "@/lib/user-status-edge"

const row = (r: unknown) => new Response(JSON.stringify(r), { status: 200 })

describe("getUserDeletedStatus", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    clearUserStatusCache()
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key"
  })

  it("deleted:true cuando users.deleted_at está seteado", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(row([{ deleted_at: "2026-10-05T00:00:00Z" }]))
    expect(await getUserDeletedStatus("u1")).toEqual({ kind: "ok", deleted: true })
  })

  it("deleted:false para un usuario normal y para una fila inexistente", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(row([{ deleted_at: null }]))
    expect(await getUserDeletedStatus("u2")).toEqual({ kind: "ok", deleted: false })
    vi.spyOn(global, "fetch").mockResolvedValue(row([]))
    expect(await getUserDeletedStatus("u3")).toEqual({ kind: "ok", deleted: false })
  })

  it("cachea 30 s: la segunda consulta no pega a Supabase", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(row([{ deleted_at: null }]))
    await getUserDeletedStatus("u4")
    await getUserDeletedStatus("u4")
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it("una baja encontrada no es fail-open: se cachea como deleted:true", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(row([{ deleted_at: "2026-10-05T00:00:00Z" }]))
    await getUserDeletedStatus("u7")
    expect(await getUserDeletedStatus("u7")).toEqual({ kind: "ok", deleted: true })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it("fail-open: si Supabase falla devuelve error (el middleware deja pasar) y no cachea", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("x", { status: 500 }))
    expect(await getUserDeletedStatus("u5")).toEqual({ kind: "error" })
    await getUserDeletedStatus("u5")
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it("fail-open: si fetch tira devuelve error", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("network"))
    expect(await getUserDeletedStatus("u8")).toEqual({ kind: "error" })
  })

  it("sin env devuelve error", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(await getUserDeletedStatus("u6")).toEqual({ kind: "error" })
  })

  it("codifica el id en la URL", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(row([]))
    await getUserDeletedStatus("a&b=c")
    expect(String(spy.mock.calls[0][0])).toContain("id=eq.a%26b%3Dc")
  })
})

describe("getUserDeletedStatus cache eviction", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    clearUserStatusCache()
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key"
  })

  it("una entrada vencida se vuelve a consultar", async () => {
    const spy = vi.spyOn(global, "fetch").mockImplementation(async () => row([{ deleted_at: null }]))
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000)
    await getUserDeletedStatus("e1")
    now.mockReturnValue(1_000 + 30_001)
    await getUserDeletedStatus("e1")
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it("el caché se vacía al pasar el tope sin romper resultados", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async () => row([{ deleted_at: null }]))
    for (let i = 0; i < 5005; i++) await getUserDeletedStatus(`bulk-${i}`)
    expect(await getUserDeletedStatus("bulk-5004")).toEqual({ kind: "ok", deleted: false })
  })
})
