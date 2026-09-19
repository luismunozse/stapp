import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockSupabaseFrom, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/superadmin-auth", () => ({
  requireSuperadmin: vi.fn().mockResolvedValue({ error: null }),
}))

import { POST } from "@/app/api/superadmin/campanas/preapproval/route"

// Suscripcion que pasa esDestinatarioDeLaCampana: paga, sin debito automatico,
// activa y sin haber recibido el mail todavia.
const SUBSCRIPCION_ELEGIBLE = {
  organization_id: "org-1",
  status: "ACTIVE",
  mercadopago_preapproval_id: null,
  organizations: { id: "org-1", nombre: "Taller Uno", email: "taller@uno.com", slug: "taller-uno", activo: true },
  plans: { precio_mensual: 19999 },
}

function mockTablas() {
  mockSupabaseFrom({
    subscriptions: createChainMock([SUBSCRIPCION_ELEGIBLE]),
    // yaSeEnvio cuenta filas SENT en lifecycle_emails: 0 = todavia no se le mando.
    lifecycle_emails: createChainMock(null, null, 0),
  })
}

describe("POST /api/superadmin/campanas/preapproval", () => {
  beforeEach(() => vi.clearAllMocks())

  it("en simulacion NO manda ningun mail", async () => {
    mockTablas()
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as never

    const res = await POST(createPostRequest({ simulacion: true }) as never)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.simulacion).toBe(true)
    expect(body.enviados).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("el modo real requiere pedirlo explicitamente", async () => {
    mockTablas()
    const res = await POST(createPostRequest({}) as never)
    const { body } = await parseResponse(res)

    // Sin decir nada, simula: mandar mails no puede ser el default.
    expect(body.simulacion).toBe(true)
  })
})
