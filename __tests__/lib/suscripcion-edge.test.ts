import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { clearSuscripcionCache, getSuscripcionBloqueada } from "@/lib/suscripcion-edge"

function respuesta(rows: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 }))
}

describe("getSuscripcionBloqueada", () => {
  beforeEach(() => {
    clearSuscripcionCache()
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.test")
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service")
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it.each([
    ["CANCELED", true],
    ["PAST_DUE", true],
    ["ACTIVE", false],
    ["TRIALING", false],
  ])("status %s → bloqueada %s", async (status, bloqueada) => {
    global.fetch = respuesta([{ status }]) as never
    expect(await getSuscripcionBloqueada("org-1")).toEqual({ kind: "ok", bloqueada })
  })

  it("sin fila no bloquea", async () => {
    global.fetch = respuesta([]) as never
    expect(await getSuscripcionBloqueada("org-1")).toEqual({ kind: "ok", bloqueada: false })
  })

  it("cachea por organización", async () => {
    const f = respuesta([{ status: "CANCELED" }])
    global.fetch = f as never
    await getSuscripcionBloqueada("org-1")
    await getSuscripcionBloqueada("org-1")
    expect(f).toHaveBeenCalledTimes(1)
  })

  it("un error de la base no se cachea y devuelve error", async () => {
    const f = vi.fn(async () => new Response("x", { status: 500 }))
    global.fetch = f as never
    expect(await getSuscripcionBloqueada("org-1")).toEqual({ kind: "error" })
    await getSuscripcionBloqueada("org-1")
    expect(f).toHaveBeenCalledTimes(2)
  })
})
