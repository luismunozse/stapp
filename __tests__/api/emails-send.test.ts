// @vitest-environment node
/**
 * Tests: POST /api/emails/send y sendAdminEmail
 *
 * Correo libre que un admin del taller manda a un destinatario: todo lo que
 * escribe el usuario se escapa, sale por el canal de cliente (no el de
 * plataforma) y tiene topes de tamaño y de volumen por organización.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockAuthError, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("@/lib/email/index", () => ({
  sendCustomer: vi.fn().mockResolvedValue({ id: "msg-1" }),
  sendPlatform: vi.fn().mockResolvedValue({ id: "msg-1" }),
  EmailSuprimidoError: class EmailSuprimidoError extends Error {},
}))

vi.mock("@/lib/rate-limit", () => ({
  persistentRateLimit: vi.fn().mockResolvedValue({ success: true, limit: 50, remaining: 49, reset: 0 }),
}))

import { sendCustomer, sendPlatform, EmailSuprimidoError } from "@/lib/email/index"
import { persistentRateLimit } from "@/lib/rate-limit"
import { sendAdminEmail, sendVerificationEmail } from "@/lib/email"
import { POST } from "@/app/api/emails/send/route"

function req(body: unknown) {
  return new Request("http://localhost/api/emails/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const BODY_OK = {
  destinatarioEmail: "cliente@example.com",
  destinatarioNombre: "Juan",
  asunto: "Tu equipo",
  contenido: "Hola, ya está listo.",
}

const XSS = '<a href="https://evil.example">clic</a>'

describe("sendAdminEmail", () => {
  beforeEach(() => vi.clearAllMocks())

  it("escapa asunto, nombre del destinatario y nombre de la organización", async () => {
    await sendAdminEmail({
      to: "a@example.com",
      nombreDestinatario: XSS,
      asunto: XSS,
      contenido: XSS,
      nombreOrganizacion: XSS,
    })

    const msg = vi.mocked(sendCustomer).mock.calls[0][0]
    expect(msg.html).not.toContain('<a href="https://evil.example"')
    expect(msg.html).toContain("&lt;a href=&quot;https://evil.example&quot;&gt;")
  })

  it("sale por el canal de cliente, no por el de plataforma", async () => {
    await sendAdminEmail({
      to: "a@example.com",
      nombreDestinatario: "Juan",
      asunto: "Hola",
      contenido: "x",
      nombreOrganizacion: "Taller",
    })

    expect(sendCustomer).toHaveBeenCalledTimes(1)
    expect(sendPlatform).not.toHaveBeenCalled()
  })
})

describe("sendVerificationEmail", () => {
  beforeEach(() => vi.clearAllMocks())

  it("escapa el nombre del usuario", async () => {
    await sendVerificationEmail({ email: "a@example.com", token: "t", nombre: XSS, slug: "acme" })

    const msg = vi.mocked(sendPlatform).mock.calls[0][0]
    expect(msg.html).not.toContain('<a href="https://evil.example">')
  })
})

describe("POST /api/emails/send", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(persistentRateLimit).mockResolvedValue({ success: true, limit: 50, remaining: 49, reset: 0 })
    vi.mocked(sendCustomer).mockResolvedValue({ id: "msg-1" } as any)
  })

  function mockDb() {
    const historial = createChainMock(null)
    mockSupabaseFrom({
      organizations: createChainMock({ nombre: "Taller" }),
      admin_emails: historial,
    })
    return historial
  }

  it("401 sin sesión", async () => {
    mockAuthError()
    const { status } = await parseResponse(await POST(req(BODY_OK)))
    expect(status).toBe(401)
  })

  it("200 y envía con un cuerpo válido", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    mockDb()

    const { status } = await parseResponse(await POST(req(BODY_OK)))

    expect(status).toBe(200)
    expect(sendCustomer).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["email inválido", { ...BODY_OK, destinatarioEmail: "no-es-email" }],
    ["asunto vacío", { ...BODY_OK, asunto: "  " }],
    ["asunto demasiado largo", { ...BODY_OK, asunto: "a".repeat(151) }],
    ["contenido demasiado largo", { ...BODY_OK, contenido: "a".repeat(10_001) }],
    ["nombre demasiado largo", { ...BODY_OK, destinatarioNombre: "a".repeat(151) }],
    ["asunto con salto de línea", { ...BODY_OK, asunto: "Hola\nBcc: x@example.com" }],
  ])("400 con %s", async (_caso, body) => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    mockDb()

    const { status } = await parseResponse(await POST(req(body)))

    expect(status).toBe(400)
    expect(sendCustomer).not.toHaveBeenCalled()
  })

  it("429 cuando la organización superó el cupo diario", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    mockDb()
    vi.mocked(persistentRateLimit).mockResolvedValue({ success: false, limit: 50, remaining: 0, reset: 0 })

    const { status } = await parseResponse(await POST(req(BODY_OK)))

    expect(status).toBe(429)
    expect(sendCustomer).not.toHaveBeenCalled()
    expect(persistentRateLimit).toHaveBeenCalledWith("org-1", "emails:send", expect.any(Number), expect.any(Number))
  })

  it("422 con mensaje claro cuando el destinatario está suprimido", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    mockDb()
    vi.mocked(sendCustomer).mockRejectedValue(new (EmailSuprimidoError as any)("bounce"))

    const { status, body } = await parseResponse(await POST(req(BODY_OK)))

    expect(status).toBe(422)
    expect(body.error).toMatch(/no acepta correos|rebot|suprimid/i)
  })
})
