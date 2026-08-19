// @vitest-environment node
/**
 * Regression test for P1a (review PR2, engram #1125): an `arca`-provider
 * credentials row has NULL legacy token columns (migration 299 made them
 * nullable for arca-only rows). Before the fix, `canEmitirFacturaElectronica`
 * returned true for any row regardless of provider, so emitir/route.ts would
 * reach `decryptSecret(cred.apitoken_enc)` with `apitoken_enc: null` and
 * throw an unhandled TypeError.
 *
 * Unlike facturacion-electronica-emitir.test.ts, this file deliberately does
 * NOT mock `@/lib/facturacion/access` — it exercises the REAL
 * `canEmitirFacturaElectronica` together with the REAL `decryptSecret`
 * (also unmocked), so a regression here surfaces as an actual unhandled
 * TypeError, not a mocked-away false positive.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({ hasPlanFeature: vi.fn() }))

import { hasPlanFeature } from "@/lib/subscriptions"
import { POST } from "@/app/api/facturacion-electronica/emitir/route"

describe("POST /emitir — arca-provider credentials gate (P1a regression)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("403s cleanly instead of crashing on decryptSecret(null) when credentials are provider='arca'", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(hasPlanFeature).mockResolvedValue(true)

    mockSupabaseFrom({
      organizations: createChainMock({ pais: "AR", facturacion_electronica_habilitada: true }),
      facturacion_credenciales: createChainMock({
        organization_id: "org-1",
        provider: "arca",
        apitoken_enc: null,
        apikey_enc: null,
        usertoken_enc: null,
      }),
    })

    const { status, body } = await parseResponse(await POST(createPostRequest({ ventaId: "venta-1" })))

    expect(status).toBe(403)
    expect(body.error).toBeDefined()
  })
})
