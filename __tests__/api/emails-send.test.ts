import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"
import { EmailSuprimidoError } from "@/lib/email/index"

vi.mock("@/lib/email", () => ({
  sendAdminEmail: vi.fn().mockResolvedValue({ id: "m1", proveedor: "resend" }),
}))

import { sendAdminEmail } from "@/lib/email"

const body = {
  destinatarioEmail: "cliente@test.com",
  destinatarioNombre: "Cliente",
  destinatarioTipo: "CLIENTE",
  asunto: "Novedades",
  contenido: "Hola",
}

async function enviar(orgEmail: string | null, nombreMostrar: string | null = null) {
  const orgChain = createChainMock({ nombre: "Taller Test", nombre_mostrar: nombreMostrar, email: orgEmail })
  const historial = createChainMock(null)
  mockSupabaseFrom({ organizations: orgChain, admin_emails: historial })
  const { POST } = await import("@/app/api/emails/send/route")
  const response = await POST(
    new Request("http://localhost:3000/api/emails/send", {
      method: "POST",
      body: JSON.stringify(body),
    }) as any
  )
  return { response, orgChain, historial }
}

describe("POST /api/emails/send", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("pasa el email del taller como replyTo", async () => {
    const { response, orgChain } = await enviar("taller@example.com")

    expect(response.status).toBe(200)
    expect(orgChain.select).toHaveBeenCalledWith(expect.stringContaining("email"))
    expect(sendAdminEmail).toHaveBeenCalledWith(
      expect.objectContaining({ nombreOrganizacion: "Taller Test", replyTo: "taller@example.com" })
    )
  })

  it("usa nombre_mostrar como nombre del remitente y cae a nombre si no hay", async () => {
    const { orgChain } = await enviar("taller@example.com", "Pepe Celulares")

    expect(orgChain.select).toHaveBeenCalledWith(expect.stringContaining("nombre_mostrar"))
    expect(sendAdminEmail).toHaveBeenLastCalledWith(
      expect.objectContaining({ nombreOrganizacion: "Pepe Celulares" })
    )

    await enviar("taller@example.com", null)
    expect(sendAdminEmail).toHaveBeenLastCalledWith(
      expect.objectContaining({ nombreOrganizacion: "Taller Test" })
    )
  })

  it("sin email del taller no pasa replyTo", async () => {
    await enviar(null)

    expect(vi.mocked(sendAdminEmail).mock.calls[0][0].replyTo).toBeUndefined()
  })

  it("si el destinatario esta suprimido registra un error claro y responde 422", async () => {
    vi.mocked(sendAdminEmail).mockRejectedValueOnce(new EmailSuprimidoError("QUEJA"))

    const { response, historial } = await enviar("taller@example.com")
    const { status, body: json } = await parseResponse(response)

    expect(status).toBe(422)
    expect(json.error).toMatch(/otra dirección/i)
    const registro = historial.insert.mock.calls[0][0]
    expect(registro.estado).toBe("ERROR")
    expect(registro.error_message).toMatch(/bloquead/i)
  })

  it("otros errores siguen siendo 500", async () => {
    vi.mocked(sendAdminEmail).mockRejectedValueOnce(new Error("proveedor caido"))

    const { response } = await enviar("taller@example.com")

    expect(response.status).toBe(500)
  })
})
