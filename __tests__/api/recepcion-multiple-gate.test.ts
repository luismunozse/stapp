/**
 * Gate de plan de POST /api/recepciones.
 *
 * Se usa hasPlanFeature (no useHasFeature) porque es el único que aplica los
 * overrides por organización de organization_feature_overrides.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn(),
}))

import { hasPlanFeature } from "@/lib/subscriptions"
import { POST } from "@/app/api/recepciones/route"

const bodyDosEquipos = {
  clienteId: "cli-1",
  terminosAceptados: true,
  equipos: [
    { dispositivo: "iPhone 13", tipoDispositivo: "CELULAR", problemaReportado: "No enciende" },
    { dispositivo: "Notebook HP", tipoDispositivo: "COMPUTADORA", problemaReportado: "Muy lenta" },
  ],
}

describe("POST /api/recepciones — gate de plan", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("devuelve 403 FEATURE_REQUIRED cuando el plan no tiene la feature", async () => {
    vi.mocked(hasPlanFeature).mockResolvedValue(false)

    const res = await POST(createPostRequest(bodyDosEquipos))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(403)
    expect(body.code).toBe("FEATURE_REQUIRED")
    expect(body.feature).toBe("recepcion_multiple")
  })

  it("consulta la feature con la key exacta recepcion_multiple", async () => {
    vi.mocked(hasPlanFeature).mockResolvedValue(false)

    await POST(createPostRequest(bodyDosEquipos))

    expect(hasPlanFeature).toHaveBeenCalledWith("org-1", "recepcion_multiple")
  })
})
