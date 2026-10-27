import { describe, it, expect, vi, beforeEach } from "vitest"

// sendCotizacionEmail y sendAdminEmail le escriben al cliente final / proveedor
// del taller: tienen que salir por el canal de cliente, no por el de plataforma.
vi.mock("@/lib/email/index", () => ({
  sendPlatform: vi.fn().mockResolvedValue({ id: "plat", proveedor: "envialosimple" }),
  sendCustomer: vi.fn().mockResolvedValue({ id: "cli", proveedor: "resend" }),
  canalClienteAceptaReplyTo: vi.fn().mockReturnValue(true),
}))

import { sendCustomer, sendPlatform, canalClienteAceptaReplyTo } from "@/lib/email/index"
import { sendCotizacionEmail, sendAdminEmail } from "@/lib/email"

const cotizacion = {
  email: "cliente@example.com",
  nombreCliente: "Ana",
  numeroCotizacion: "COT-0001",
  numeroOrden: 7,
  total: 15000,
  pdfBuffer: Buffer.from("pdf-bytes"),
}

describe("sendCotizacionEmail", () => {
  beforeEach(() => vi.clearAllMocks())

  it("sale por sendCustomer con el PDF adjunto, fromName y replyTo", async () => {
    const result = await sendCotizacionEmail({
      ...cotizacion,
      fromName: "Taller Pepe",
      replyTo: "taller@example.com",
    })

    expect(sendPlatform).not.toHaveBeenCalled()
    expect(sendCustomer).toHaveBeenCalledTimes(1)
    const msg = vi.mocked(sendCustomer).mock.calls[0][0]
    expect(msg.to).toBe("cliente@example.com")
    expect(msg.fromName).toBe("Taller Pepe")
    expect(msg.replyTo).toBe("taller@example.com")
    expect(msg.attachments).toEqual([
      {
        content: Buffer.from("pdf-bytes").toString("base64"),
        filename: "COT-0001.pdf",
        type: "application/pdf",
      },
    ])
    expect(result).toEqual({ id: "cli", proveedor: "resend" })
  })

  it("con replyTo invita a responder al correo", async () => {
    await sendCotizacionEmail({ ...cotizacion, replyTo: "taller@example.com" })

    const { html } = vi.mocked(sendCustomer).mock.calls[0][0]
    expect(html).toContain("responda a este correo")
    expect(html).toContain("Responde a este correo")
  })

  it("con replyTo pero sin Resend (el fallback lo descarta) no invita a responder", async () => {
    vi.mocked(canalClienteAceptaReplyTo).mockReturnValueOnce(false)

    await sendCotizacionEmail({ ...cotizacion, replyTo: "taller@example.com" })

    const { html } = vi.mocked(sendCustomer).mock.calls[0][0]
    expect(html).not.toMatch(/responda a este correo/i)
    expect(html).not.toMatch(/responde a este correo/i)
    expect(html).toContain("contáctenos")
  })

  it("sin replyTo no invita a responder al correo", async () => {
    await sendCotizacionEmail({ ...cotizacion, fromName: "Taller Pepe" })

    const msg = vi.mocked(sendCustomer).mock.calls[0][0]
    expect(msg.replyTo).toBeUndefined()
    expect(msg.html).not.toMatch(/responda a este correo/i)
    expect(msg.html).not.toMatch(/responde a este correo/i)
    expect(msg.html).toContain("contáctenos")
  })
})

describe("sendAdminEmail", () => {
  beforeEach(() => vi.clearAllMocks())

  const admin = {
    to: "cliente@example.com",
    nombreDestinatario: "Ana",
    asunto: "Novedades",
    contenido: "Hola <b>mundo</b>",
    nombreOrganizacion: "Taller Pepe",
  }

  it("sale por sendCustomer con el nombre del taller y replyTo", async () => {
    const result = await sendAdminEmail({ ...admin, replyTo: "taller@example.com" })

    expect(sendPlatform).not.toHaveBeenCalled()
    const msg = vi.mocked(sendCustomer).mock.calls[0][0]
    expect(msg.to).toBe("cliente@example.com")
    expect(msg.subject).toBe("Novedades - Taller Pepe")
    expect(msg.fromName).toBe("Taller Pepe")
    expect(msg.replyTo).toBe("taller@example.com")
    expect(msg.html).toContain("&lt;b&gt;mundo&lt;/b&gt;")
    expect(result).toEqual({ id: "cli", proveedor: "resend" })
  })

  it("sin replyTo no lo manda y el HTML no invita a responder", async () => {
    await sendAdminEmail(admin)

    const msg = vi.mocked(sendCustomer).mock.calls[0][0]
    expect(msg.replyTo).toBeUndefined()
    expect(msg.html).not.toMatch(/respond/i)
  })
})
