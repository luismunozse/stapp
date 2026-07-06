import { describe, it, expect, beforeEach, vi } from "vitest"
import { mockSupabaseFrom, createChainMock, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({ hasPlanFeature: vi.fn() }))

import { hasPlanFeature } from "@/lib/subscriptions"
import { POST } from "@/app/api/public/catalogo/[slug]/cotizar/route"

const VALID_BODY = {
  cliente: { nombre: "Ana", telefono: "1122334455" },
  consent: true,
  items: [{ itemId: "i1", cantidad: 1 }],
}

function callPost() {
  return POST(createPostRequest(VALID_BODY), { params: Promise.resolve({ slug: "mi-taller" }) })
}

describe("POST /api/public/catalogo/[slug]/cotizar — plan gating", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseFrom({
      catalogo_config: createChainMock({
        organization_id: "org-1",
        activo: true,
        whatsapp: null,
        titulo: "X",
      }),
    })
  })

  it("returns 403 FEATURE_REQUIRED when the org lacks cotizaciones_online", async () => {
    vi.mocked(hasPlanFeature).mockResolvedValue(false)

    const res = await callPost()
    const { status, body } = await parseResponse(res)

    expect(status).toBe(403)
    expect(body.code).toBe("FEATURE_REQUIRED")
  })

  it("does not gate the request when the org has cotizaciones_online", async () => {
    vi.mocked(hasPlanFeature).mockResolvedValue(true)

    const res = await callPost()

    expect(res.status).not.toBe(403)
  })
})
