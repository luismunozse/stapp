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

  it("sendCustomer con RESEND_API_KEY sale por Resend", async () => {
    process.env.RESEND_API_KEY = "re_test"
    process.env.RESEND_FROM = "avisos@avisos.stapp.com.ar"
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "re-1" }),
    }) as any

    const { sendCustomer } = await import("../index")
    const result = await sendCustomer({ to: "a@b.com", subject: "s", html: "h" })

    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe("https://api.resend.com/emails")
    expect(result.proveedor).toBe("resend")
  })

  it("un 401 de Resend NO cae a EnvialoSimple", async () => {
    process.env.RESEND_API_KEY = "re_malformada"
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "API key is invalid",
    }) as any

    const { sendCustomer } = await import("../index")

    await expect(sendCustomer({ to: "a@b.com", subject: "s", html: "h" })).rejects.toThrow()
    // Un solo intento: no hay segundo fetch al proveedor de plataforma.
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it("sendPlatform sigue por EnvialoSimple aunque RESEND_API_KEY este seteada", async () => {
    process.env.RESEND_API_KEY = "re_test"
    process.env.RESEND_FROM = "avisos@avisos.stapp.com.ar"

    const { sendPlatform } = await import("../index")
    const result = await sendPlatform({ to: "a@b.com", subject: "s", html: "h" })

    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(ENV_URL)
    expect(result.proveedor).toBe("envialosimple")
  })
})
