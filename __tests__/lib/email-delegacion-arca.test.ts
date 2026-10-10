import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/email/index", () => ({
  sendPlatform: vi.fn().mockResolvedValue({ id: "m1", proveedor: "resend" }),
}))

import { sendPlatform } from "@/lib/email/index"
import { sendDelegacionArcaPendienteNotification } from "@/lib/email"
import { CONTACT_EMAIL } from "@/lib/contact"

const params = {
  organizationId: "org-123",
  organizationName: "Taller <b>Uno</b>",
  cuit: "30710955057",
  puntoVenta: 3,
  condicionFiscal: "RESPONSABLE_INSCRIPTO",
}

describe("sendDelegacionArcaPendienteNotification", () => {
  const original = process.env.PLATFORM_NOTIFICATION_EMAIL

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.PLATFORM_NOTIFICATION_EMAIL
  })
  afterEach(() => {
    if (original === undefined) delete process.env.PLATFORM_NOTIFICATION_EMAIL
    else process.env.PLATFORM_NOTIFICATION_EMAIL = original
  })

  it("manda a PLATFORM_NOTIFICATION_EMAIL con los datos y los dos pasos de ARCA", async () => {
    process.env.PLATFORM_NOTIFICATION_EMAIL = "luis@example.com"

    await sendDelegacionArcaPendienteNotification(params)

    const msg = vi.mocked(sendPlatform).mock.calls[0][0]
    expect(msg.to).toBe("luis@example.com")
    expect(msg.html).toContain("org-123")
    expect(msg.html).toContain("30710955057")
    expect(msg.html).toContain("Aceptación de Designación")
    expect(msg.html).toContain("Administrador de Relaciones")
    expect(msg.html).toContain("stapp-prod")
    // El nombre lo escribe el taller: no puede inyectar HTML en el mail.
    expect(msg.html).not.toContain("<b>Uno</b>")
    expect(msg.html).toContain("&lt;b&gt;Uno&lt;/b&gt;")
  })

  it("cae a la casilla de contacto y deja un warning visible", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    await sendDelegacionArcaPendienteNotification(params)

    expect(vi.mocked(sendPlatform).mock.calls[0][0].to).toBe(CONTACT_EMAIL)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain("PLATFORM_NOTIFICATION_EMAIL")
    warn.mockRestore()
  })
})
