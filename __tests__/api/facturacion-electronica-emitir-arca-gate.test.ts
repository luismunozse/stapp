// @vitest-environment node
/**
 * Regresión de la fila `arca` incompleta. Una fila con provider='arca' tiene
 * las columnas de token legacy en NULL (la migración 299 las hizo nullable
 * justamente para eso). Si el gate la dejara pasar sin certificado, la ruta
 * llegaría a descifrar un NULL y tiraría un TypeError sin manejar.
 *
 * Desde la Fase 4 el proveedor ARCA SÍ emite, así que el gate ya no rechaza
 * por proveedor: rechaza por certificado. Esta fila no trae `cert_not_after`,
 * y `canEmitirFacturaElectronica` falla cerrado ante eso.
 *
 * A diferencia de facturacion-electronica-emitir.test.ts, este archivo NO
 * mockea `@/lib/facturacion/access` — ejercita el gate real junto con el
 * `decryptSecret` real, así que una regresión acá aparece como un TypeError
 * de verdad y no como un falso verde mockeado.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({ hasPlanFeature: vi.fn() }))

import { hasPlanFeature } from "@/lib/subscriptions"
import { POST } from "@/app/api/facturacion-electronica/emitir/route"

describe("POST /emitir — arca-provider credentials gate (P1a regression)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("403s cleanly instead of crashing on decryptSecret(null) when an arca row has no certificate", async () => {
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
