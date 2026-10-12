import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

const ENV_URL = "https://backend.envialosimple.email/api/v1/mail/send"

describe("envialoSimpleProvider", () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.ENVIALOSIMPLE_API_KEY = "key-test"
    process.env.EMAIL_FROM = "noreply@stapp.com.ar"
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "es-123" }),
    }) as any
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("pega a la URL de EnvialoSimple y devuelve el id", async () => {
    const { envialoSimpleProvider } = await import("../providers/envialosimple")

    const result = await envialoSimpleProvider.send({
      to: "cliente@example.com",
      subject: "Asunto",
      html: "<p>hola</p>",
    })

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(global.fetch).mock.calls[0]
    expect(url).toBe(ENV_URL)
    expect((init as any).headers.Authorization).toBe("Bearer key-test")
    expect(result).toEqual({ id: "es-123", proveedor: "envialosimple" })
  })

  it("compone el from con el nombre visible sobre la direccion verificada", async () => {
    const { envialoSimpleProvider } = await import("../providers/envialosimple")

    await envialoSimpleProvider.send({
      to: "cliente@example.com",
      subject: "Asunto",
      html: "<p>hola</p>",
      fromName: "Taller Pepe",
    })

    const body = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string)
    expect(body.from).toBe("Taller Pepe <noreply@stapp.com.ar>")
  })

  it("mapea adjuntos con disposition attachment", async () => {
    const { envialoSimpleProvider } = await import("../providers/envialosimple")

    await envialoSimpleProvider.send({
      to: "cliente@example.com",
      subject: "Asunto",
      html: "<p>hola</p>",
      attachments: [{ filename: "a.pdf", content: "YmFzZTY0", type: "application/pdf" }],
    })

    const body = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string)
    expect(body.attachments).toEqual([
      { filename: "a.pdf", content: "YmFzZTY0", type: "application/pdf", disposition: "attachment" },
    ])
  })

  it("tira si falta la API key", async () => {
    delete process.env.ENVIALOSIMPLE_API_KEY
    const { envialoSimpleProvider } = await import("../providers/envialosimple")

    await expect(
      envialoSimpleProvider.send({ to: "a@b.com", subject: "s", html: "h" })
    ).rejects.toThrow("ENVIALOSIMPLE_API_KEY no esta configurada")
  })

  it("tira con el cuerpo del error si el proveedor responde no-ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "direccion invalida",
    }) as any
    const { envialoSimpleProvider } = await import("../providers/envialosimple")

    await expect(
      envialoSimpleProvider.send({ to: "a@b.com", subject: "s", html: "h" })
    ).rejects.toThrow("direccion invalida")
  })
})
