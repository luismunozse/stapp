import { describe, it, expect, vi, afterEach } from "vitest"

vi.mock("../suppression", () => ({
  estaSuprimido: vi.fn().mockResolvedValue(null),
  EmailSuprimidoError: class extends Error {},
}))

import { canalClienteAceptaReplyTo } from "../index"

describe("canalClienteAceptaReplyTo", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("es true cuando el canal de cliente resuelve a Resend", () => {
    vi.stubEnv("RESEND_API_KEY", "re_test")
    expect(canalClienteAceptaReplyTo()).toBe(true)
  })

  it("es false cuando cae a EnvialoSimple, que ignora el reply-to", () => {
    vi.stubEnv("RESEND_API_KEY", "")
    expect(canalClienteAceptaReplyTo()).toBe(false)
  })
})
