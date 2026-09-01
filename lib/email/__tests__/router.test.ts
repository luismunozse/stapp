import { describe, it, expect, beforeEach, vi } from "vitest"

const ENV_URL = "https://backend.envialosimple.email/api/v1/mail/send"

describe("router de email", () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.ENVIALOSIMPLE_API_KEY = "key-test"
    process.env.EMAIL_FROM = "noreply@stapp.com.ar"
    delete process.env.RESEND_API_KEY
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "es-1" }),
    }) as any
  })

  it("sendPlatform sale por EnvialoSimple", async () => {
    const { sendPlatform } = await import("../index")
    await sendPlatform({ to: "a@b.com", subject: "s", html: "h" })
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(ENV_URL)
  })

  it("sendCustomer sin RESEND_API_KEY cae a EnvialoSimple", async () => {
    const { sendCustomer } = await import("../index")
    const result = await sendCustomer({ to: "a@b.com", subject: "s", html: "h" })
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(ENV_URL)
    expect(result.proveedor).toBe("envialosimple")
  })
})
