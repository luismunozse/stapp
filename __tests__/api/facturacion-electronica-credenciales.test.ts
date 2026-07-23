// @vitest-environment node
/**
 * Tests: /api/facturacion-electronica/credenciales
 *
 * ADMIN-only endpoint. GET exposes connection status only (never secrets).
 * PUT encrypts and upserts the three provider secrets.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/facturacion/crypto", () => ({
  encryptSecret: (s: string) => `enc(${s})`,
  decryptSecret: (s: string) => s,
}))

import { GET, PUT } from "@/app/api/facturacion-electronica/credenciales/route"

describe("facturacion-electronica/credenciales", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("GET 401 unauthenticated", async () => {
    mockAuthError()

    const { status } = await parseResponse(await GET())

    expect(status).toBe(401)
  })

  it("GET returns status only, never secrets", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "o1" })
    mockSupabaseFrom({
      facturacion_credenciales: createChainMock({
        organization_id: "o1",
        punto_venta: 3,
        condicion_fiscal: "MONOTRIBUTO",
        updated_at: "2026-07-23",
        apitoken_enc: "enc(x)",
      }),
    })

    const { status, body } = await parseResponse(await GET())

    expect(status).toBe(200)
    expect(body.conectado).toBe(true)
    expect(body.puntoVenta).toBe(3)
    expect(body.condicionFiscal).toBe("MONOTRIBUTO")
    expect(body.updatedAt).toBe("2026-07-23")
    expect(JSON.stringify(body)).not.toContain("enc(")
    expect(body.apitoken_enc).toBeUndefined()
    expect(body.apikey_enc).toBeUndefined()
    expect(body.usertoken_enc).toBeUndefined()
  })

  it("GET returns conectado=false when no row exists", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "o1" })
    mockSupabaseFrom({
      facturacion_credenciales: createChainMock(null),
    })

    const { status, body } = await parseResponse(await GET())

    expect(status).toBe(200)
    expect(body.conectado).toBe(false)
    expect(body.puntoVenta).toBeNull()
    expect(body.condicionFiscal).toBeNull()
    expect(body.updatedAt).toBeNull()
  })

  it("PUT 403 for non-ADMIN", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })

    const { status } = await parseResponse(
      await PUT(
        createPostRequest({
          apitoken: "a",
          apikey: "k",
          usertoken: "u",
          puntoVenta: 1,
          condicionFiscal: "MONOTRIBUTO",
        })
      )
    )

    expect(status).toBe(403)
  })

  it("PUT encrypts secrets and upserts, response never includes them", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "o1" })
    const upsertSpy = vi.fn().mockResolvedValue({ data: null, error: null })
    mockSupabaseFrom({
      facturacion_credenciales: { upsert: upsertSpy } as any,
    })

    const { status, body } = await parseResponse(
      await PUT(
        createPostRequest({
          apitoken: "a",
          apikey: "k",
          usertoken: "u",
          puntoVenta: 3,
          condicionFiscal: "RESPONSABLE_INSCRIPTO",
        })
      )
    )

    expect(status).toBe(200)
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: "o1",
        apitoken_enc: "enc(a)",
        apikey_enc: "enc(k)",
        usertoken_enc: "enc(u)",
        punto_venta: 3,
        condicion_fiscal: "RESPONSABLE_INSCRIPTO",
      })
    )
    expect(JSON.stringify(body)).not.toContain("enc(")
  })
})
