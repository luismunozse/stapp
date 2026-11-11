// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const lookupMock = vi.fn()
vi.mock("node:dns", () => ({ promises: { lookup: (...a: unknown[]) => lookupMock(...a) } }))

import { esIpInterna, validarDestinoWebhook } from "@/lib/webhooks/destino-seguro"

describe("esIpInterna", () => {
  it.each([
    "127.0.0.1", "127.1.2.3", "10.0.0.1", "172.16.5.4", "172.31.255.255", "192.168.1.1",
    "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "ff02::1",
  ])("%s es interna", (ip) => expect(esIpInterna(ip)).toBe(true))

  it.each(["8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700::1111", "::ffff:8.8.8.8"])(
    "%s es pública", (ip) => expect(esIpInterna(ip)).toBe(false)
  )

  it("algo que no es IP se trata como interno", () => expect(esIpInterna("no-ip")).toBe(true))
})

describe("validarDestinoWebhook", () => {
  beforeEach(() => lookupMock.mockReset())

  it("acepta https a un host público", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }])
    expect(await validarDestinoWebhook("https://example.com/hook")).toEqual({ ok: true })
  })

  it("rechaza http", async () => {
    const r = await validarDestinoWebhook("http://example.com/hook")
    expect(r.ok).toBe(false)
  })

  it("rechaza una IP interna literal sin resolver DNS", async () => {
    for (const u of ["https://127.0.0.1:9001/x", "https://[::1]/x", "https://169.254.169.254/latest"]) {
      expect((await validarDestinoWebhook(u)).ok).toBe(false)
    }
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it("rechaza localhost y .internal sin resolver", async () => {
    for (const u of ["https://localhost/x", "https://api.localhost/x", "https://db.internal/x"]) {
      expect((await validarDestinoWebhook(u)).ok).toBe(false)
    }
  })

  it("rechaza si alguna de las IPs resueltas es interna", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ])
    const r = await validarDestinoWebhook("https://mixto.example.com/")
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/red interna/) })
  })

  it("rechaza si el DNS no resuelve o no devuelve direcciones", async () => {
    lookupMock.mockImplementation(() => Promise.reject("ENOTFOUND"))
    expect((await validarDestinoWebhook("https://no-existe.example/")).ok).toBe(false)
    lookupMock.mockResolvedValue([])
    expect((await validarDestinoWebhook("https://vacio.example/")).ok).toBe(false)
  })

  it("rechaza URLs mal formadas", async () => {
    expect((await validarDestinoWebhook("no es url")).ok).toBe(false)
  })
})
