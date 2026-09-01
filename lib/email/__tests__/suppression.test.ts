import { describe, it, expect, beforeEach, vi } from "vitest"
import { createChainMock, mockSupabaseFrom } from "@/__tests__/api/helpers"

describe("supresion de email", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.RESEND_API_KEY = "re_test"
    process.env.RESEND_FROM = "avisos@avisos.stapp.com.ar"
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "re-1" }),
    }) as any
  })

  it("no envia a una direccion suprimida y tira EmailSuprimidoError", async () => {
    mockSupabaseFrom({
      email_suprimidos: createChainMock({ motivo: "HARD_BOUNCE" }),
    })

    const { sendCustomer } = await import("../index")

    await expect(
      sendCustomer({ to: "muerta@example.com", subject: "s", html: "h" })
    ).rejects.toThrow("email suprimido: HARD_BOUNCE")

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("envia normal si la direccion no esta suprimida", async () => {
    mockSupabaseFrom({
      email_suprimidos: createChainMock(null),
    })

    const { sendCustomer } = await import("../index")
    const result = await sendCustomer({ to: "viva@example.com", subject: "s", html: "h" })

    expect(result.proveedor).toBe("resend")
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it("si el lookup de supresion falla, ENVIA igual (fail open)", async () => {
    mockSupabaseFrom({
      email_suprimidos: createChainMock(null, { message: "connection reset" }),
    })

    const { sendCustomer } = await import("../index")
    const result = await sendCustomer({ to: "quien@example.com", subject: "s", html: "h" })

    expect(result.proveedor).toBe("resend")
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it("el chequeo corre TAMBIEN durante el fallback a EnvialoSimple", async () => {
    delete process.env.RESEND_API_KEY
    process.env.ENVIALOSIMPLE_API_KEY = "key-test"
    mockSupabaseFrom({
      email_suprimidos: createChainMock({ motivo: "QUEJA" }),
    })

    const { sendCustomer } = await import("../index")

    await expect(
      sendCustomer({ to: "muerta@example.com", subject: "s", html: "h" })
    ).rejects.toThrow("email suprimido: QUEJA")

    expect(global.fetch).not.toHaveBeenCalled()
  })
})
