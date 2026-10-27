import { describe, it, expect, beforeEach, vi } from "vitest"

const RESEND_URL = "https://api.resend.com/emails"

describe("resendProvider", () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.RESEND_API_KEY = "re_test"
    process.env.RESEND_FROM = "avisos@avisos.stapp.com.ar"
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" }),
    }) as any
  })

  it("pega a la API de Resend con bearer y devuelve el id", async () => {
    const { resendProvider } = await import("../providers/resend")

    const result = await resendProvider.send({
      to: "cliente@example.com",
      subject: "Tu orden esta lista",
      html: "<p>hola</p>",
    })

    const [url, init] = vi.mocked(global.fetch).mock.calls[0]
    expect(url).toBe(RESEND_URL)
    expect((init as any).headers.Authorization).toBe("Bearer re_test")
    expect(result).toEqual({
      id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794",
      proveedor: "resend",
    })
  })

  it("usa el nombre del taller sobre la direccion del subdominio de avisos", async () => {
    const { resendProvider } = await import("../providers/resend")

    await resendProvider.send({
      to: "cliente@example.com",
      subject: "s",
      html: "h",
      fromName: "Taller Pepe",
    })

    const body = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string)
    expect(body.from).toBe("Taller Pepe <avisos@avisos.stapp.com.ar>")
  })

  it("sanea el nombre del taller en el from (comillas, comas y CR/LF)", async () => {
    const { resendProvider } = await import("../providers/resend")

    await resendProvider.send({ to: "a@b.com", subject: "s", html: "h", fromName: 'Taller "Pepe", S.A.' })
    await resendProvider.send({ to: "a@b.com", subject: "s", html: "h", fromName: "Taller\r\nBcc: x@y.com" })

    const calls = vi.mocked(global.fetch).mock.calls
    expect(JSON.parse(calls[0][1]!.body as string).from).toBe(
      '"Taller Pepe, S.A." <avisos@avisos.stapp.com.ar>'
    )
    const inyectado = JSON.parse(calls[1][1]!.body as string).from
    expect(inyectado).not.toMatch(/[\r\n]/)
    expect(inyectado).toBe('"Taller Bcc: x@y.com" <avisos@avisos.stapp.com.ar>')
  })

  it("tira si le pasan substitutions, que Resend no soporta", async () => {
    const { resendProvider } = await import("../providers/resend")

    await expect(
      resendProvider.send({ to: "a@b.com", subject: "s", html: "h", substitutions: { x: "1" } })
    ).rejects.toThrow("substitutions")
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("manda los attachments con los nombres de campo de Resend", async () => {
    const { resendProvider } = await import("../providers/resend")

    await resendProvider.send({
      to: "a@b.com",
      subject: "s",
      html: "h",
      attachments: [{ filename: "a.pdf", content: "YmFzZTY0", type: "application/pdf" }],
    })

    const body = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string)
    expect(body.attachments).toEqual([
      { filename: "a.pdf", content: "YmFzZTY0", content_type: "application/pdf" },
    ])
  })

  it("no manda el campo attachments si no hay adjuntos", async () => {
    const { resendProvider } = await import("../providers/resend")

    await resendProvider.send({ to: "a@b.com", subject: "s", html: "h", attachments: [] })

    const body = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string)
    expect(body).not.toHaveProperty("attachments")
  })

  it("manda reply_to cuando hay replyTo", async () => {
    const { resendProvider } = await import("../providers/resend")

    await resendProvider.send({
      to: "a@b.com",
      subject: "s",
      html: "h",
      replyTo: "taller@example.com",
    })

    const body = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string)
    expect(body.reply_to).toBe("taller@example.com")
  })

  it("no manda reply_to cuando no hay replyTo", async () => {
    const { resendProvider } = await import("../providers/resend")

    await resendProvider.send({ to: "a@b.com", subject: "s", html: "h" })

    const body = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string)
    expect(body).not.toHaveProperty("reply_to")
  })

  it("tira si falta la API key", async () => {
    delete process.env.RESEND_API_KEY
    const { resendProvider } = await import("../providers/resend")

    await expect(
      resendProvider.send({ to: "a@b.com", subject: "s", html: "h" })
    ).rejects.toThrow("RESEND_API_KEY no esta configurada")
  })

  it("tira con el cuerpo del error si Resend responde no-ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"message":"API key is invalid"}',
    }) as any
    const { resendProvider } = await import("../providers/resend")

    await expect(
      resendProvider.send({ to: "a@b.com", subject: "s", html: "h" })
    ).rejects.toThrow("API key is invalid")
  })
})
