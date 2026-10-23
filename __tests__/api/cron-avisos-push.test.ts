import { describe, it, expect, vi, beforeEach } from "vitest"

const enviarPushDeAvisos = vi.fn()
vi.mock("@/lib/notifications/push-avisos", () => ({
  enviarPushDeAvisos: (...a: unknown[]) => enviarPushDeAvisos(...a),
}))

import { GET } from "@/app/api/cron/avisos-push/route"

const req = (token = "s3cret") =>
  new Request("http://localhost/api/cron/avisos-push", { headers: { authorization: `Bearer ${token}` } })

describe("GET /api/cron/avisos-push", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("CRON_SECRET", "s3cret")
    vi.spyOn(console, "error").mockImplementation(() => {})
    enviarPushDeAvisos.mockResolvedValue({ claimed: 2, usuarios: 2, enviados: 2, fallidos: 0 })
  })

  it("401 sin el secreto correcto", async () => {
    const res = await GET(req("otro"))
    expect(res.status).toBe(401)
    expect(enviarPushDeAvisos).not.toHaveBeenCalled()
  })

  it("500 si CRON_SECRET no esta configurado", async () => {
    vi.stubEnv("CRON_SECRET", "")
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(enviarPushDeAvisos).not.toHaveBeenCalled()
  })

  it("200 corre el barrido y devuelve el resumen", async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(enviarPushDeAvisos).toHaveBeenCalledTimes(1)
    expect(await res.json()).toMatchObject({ success: true, claimed: 2, enviados: 2 })
  })

  it("500 si el barrido reporta error del RPC", async () => {
    enviarPushDeAvisos.mockResolvedValue({ claimed: 0, usuarios: 0, enviados: 0, fallidos: 0, error: "boom" })
    const res = await GET(req())
    expect(res.status).toBe(500)
  })

  it("500 si el transporte push no esta configurado (queda en los logs de Vercel)", async () => {
    enviarPushDeAvisos.mockResolvedValue({ claimed: 3, usuarios: 3, enviados: 0, fallidos: 0, sinConfiguracion: true })
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ sinConfiguracion: true })
  })

  it("500 si el barrido tira", async () => {
    enviarPushDeAvisos.mockRejectedValue(new Error("x"))
    const res = await GET(req())
    expect(res.status).toBe(500)
  })
})
