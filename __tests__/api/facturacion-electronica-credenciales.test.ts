// @vitest-environment node
/**
 * Tests: /api/facturacion-electronica/credenciales
 *
 * ADMIN-only endpoint, reescrito para el proveedor ARCA directo
 * (sdd/facturacion-arca-directa, design ADR-01/ADR-04/ADR-14, tasks 1.6).
 * GET expone metadata derivada del certificado (nunca el PEM). PUT es
 * write-only: valida el par cert/clave, cifra y persiste — nunca ecoa el
 * secreto de vuelta, ni siquiera en el 200 de éxito.
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
  encryptSecret: vi.fn((s: string) => `enc(${s})`),
  decryptSecret: vi.fn((s: string) => s),
}))

vi.mock("@/lib/facturacion/arca/cert", async () => {
  const actual = await vi.importActual<typeof import("@/lib/facturacion/arca/cert")>(
    "@/lib/facturacion/arca/cert"
  )
  return { ...actual, validateCertKeyPair: vi.fn() }
})

import { encryptSecret } from "@/lib/facturacion/crypto"
import { validateCertKeyPair, CertValidationError } from "@/lib/facturacion/arca/cert"
import { GET, PUT } from "@/app/api/facturacion-electronica/credenciales/route"

const VALID_RESULT = {
  cuit: "20123456789",
  subject: "C=AR\nO=Test Org\nCN=Test\nserialNumber=CUIT 20123456789",
  fingerprint: "AA:BB:CC",
  notBefore: "2026-01-01T00:00:00.000Z",
  notAfter: "2030-01-01T00:00:00.000Z",
}

describe("facturacion-electronica/credenciales", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(validateCertKeyPair as any).mockReturnValue(VALID_RESULT)
    ;(encryptSecret as any).mockImplementation((s: string) => `enc(${s})`)
  })

  describe("GET", () => {
    it("401 unauthenticated", async () => {
      mockAuthError()
      const { status } = await parseResponse(await GET())
      expect(status).toBe(401)
    })

    it("sin_configurar / conectado=false when no row exists", async () => {
      mockAuthSuccess({ role: "ADMIN", organizationId: "o1" })
      mockSupabaseFrom({ facturacion_credenciales: createChainMock(null) })

      const { status, body } = await parseResponse(await GET())

      expect(status).toBe(200)
      expect(body.conectado).toBe(false)
      expect(body.estado).toBe("sin_configurar")
      expect(body.cuit).toBeNull()
    })

    it("returns derived cert metadata, never the PEM material", async () => {
      mockAuthSuccess({ role: "ADMIN", organizationId: "o1" })
      mockSupabaseFrom({
        facturacion_credenciales: createChainMock({
          organization_id: "o1",
          provider: "arca",
          cuit: "20123456789",
          cert_subject: VALID_RESULT.subject,
          cert_not_before: "2026-01-01T00:00:00.000Z",
          cert_not_after: "2030-01-01T00:00:00.000Z",
          cert_fingerprint: "AA:BB:CC",
          estado: "conectado",
          punto_venta: 1,
          condicion_fiscal: "MONOTRIBUTO",
          updated_at: "2026-08-19",
          cert_pem_enc: "enc(should-never-appear)",
          key_pem_enc: "enc(should-never-appear-either)",
        }),
      })

      const { status, body } = await parseResponse(await GET())

      expect(status).toBe(200)
      expect(body.conectado).toBe(true)
      expect(body.provider).toBe("arca")
      expect(body.estado).toBe("conectado")
      expect(body.cuit).toBe("20123456789")
      expect(body.certSubject).toBe(VALID_RESULT.subject)
      expect(body.certNotAfter).toBe("2030-01-01T00:00:00.000Z")
      expect(JSON.stringify(body)).not.toContain("should-never-appear")
      expect(body.cert_pem_enc).toBeUndefined()
      expect(body.key_pem_enc).toBeUndefined()
      expect(body.certPemEnc).toBeUndefined()
      expect(body.keyPemEnc).toBeUndefined()
    })

    it("computes estado=cert_vencido when cert_not_after has passed, overriding the stored estado", async () => {
      mockAuthSuccess({ role: "ADMIN", organizationId: "o1" })
      mockSupabaseFrom({
        facturacion_credenciales: createChainMock({
          organization_id: "o1",
          provider: "arca",
          cuit: "20123456789",
          cert_not_after: "2020-01-01T00:00:00.000Z",
          estado: "conectado",
        }),
      })

      const { body } = await parseResponse(await GET())
      expect(body.estado).toBe("cert_vencido")
    })

    it("degrades tier-A (migration 299 missing) to sin_configurar with migracionPendiente flag", async () => {
      mockAuthSuccess({ role: "ADMIN", organizationId: "o1" })
      mockSupabaseFrom({
        facturacion_credenciales: createChainMock(null, {
          code: "42703",
          message: "column facturacion_credenciales.provider does not exist",
        }),
      })

      const { status, body } = await parseResponse(await GET())
      expect(status).toBe(200)
      expect(body.estado).toBe("sin_configurar")
      expect(body.conectado).toBe(false)
      expect(body.migracionPendiente).toBe(true)
    })
  })

  describe("PUT", () => {
    function putBody(overrides: any = {}) {
      return createPostRequest({
        certPem: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----",
        keyPem: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----",
        cuit: "20123456789",
        condicionFiscal: "MONOTRIBUTO",
        ...overrides,
      })
    }

    it("403 for non-ADMIN", async () => {
      mockAuthSuccess({ role: "VENDEDOR" })
      const { status } = await parseResponse(await PUT(putBody()))
      expect(status).toBe(403)
    })

    it("400 when certPem, keyPem or cuit is missing", async () => {
      mockAuthSuccess({ role: "ADMIN", organizationId: "o1" })
      const { status, body } = await parseResponse(await PUT(putBody({ keyPem: undefined })))
      expect(status).toBe(400)
      expect(body.error).toBeDefined()
      expect(validateCertKeyPair).not.toHaveBeenCalled()
    })

    it("400 when cuit is not an 11-digit number", async () => {
      mockAuthSuccess({ role: "ADMIN", organizationId: "o1" })
      const { status, body } = await parseResponse(await PUT(putBody({ cuit: "abc" })))
      expect(status).toBe(400)
      expect(body.error).toMatch(/cuit/i)
      expect(validateCertKeyPair).not.toHaveBeenCalled()
    })

    it("400 with the validator's code when the cert/key pair does not match", async () => {
      mockAuthSuccess({ role: "ADMIN", organizationId: "o1" })
      ;(validateCertKeyPair as any).mockImplementation(() => {
        throw new CertValidationError("MODULUS_MISMATCH", "no matchean")
      })

      const { status, body } = await parseResponse(await PUT(putBody()))
      expect(status).toBe(400)
      expect(body.code).toBe("MODULUS_MISMATCH")
    })

    it("400 with the validator's code when the CUIT does not match the cert", async () => {
      mockAuthSuccess({ role: "ADMIN", organizationId: "o1" })
      ;(validateCertKeyPair as any).mockImplementation(() => {
        throw new CertValidationError("CUIT_MISMATCH", "cuit distinto")
      })

      const { status, body } = await parseResponse(await PUT(putBody()))
      expect(status).toBe(400)
      expect(body.code).toBe("CUIT_MISMATCH")
    })

    it("encrypts, upserts as provider=arca, and never echoes the PEM material back", async () => {
      mockAuthSuccess({ role: "ADMIN", organizationId: "o1" })
      const upsertSpy = vi.fn().mockResolvedValue({ data: null, error: null })
      mockSupabaseFrom({ facturacion_credenciales: { upsert: upsertSpy } as any })

      const { status, body } = await parseResponse(await PUT(putBody()))

      expect(status).toBe(200)
      expect(upsertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: "o1",
          provider: "arca",
          cert_pem_enc: expect.stringContaining("enc("),
          key_pem_enc: expect.stringContaining("enc("),
          cuit: VALID_RESULT.cuit,
          cert_subject: VALID_RESULT.subject,
          cert_fingerprint: VALID_RESULT.fingerprint,
          cert_not_before: VALID_RESULT.notBefore,
          cert_not_after: VALID_RESULT.notAfter,
          condicion_fiscal: "MONOTRIBUTO",
          estado: "conectado",
        })
      )
      expect(JSON.stringify(body)).not.toContain("fake")
      expect(body.cert_pem_enc).toBeUndefined()
      expect(body.certPem).toBeUndefined()
      expect(body.keyPem).toBeUndefined()
    })

    it("500 'cifrado no configurado' when FACTURACION_ENCRYPTION_KEY is unset (encryptSecret throws)", async () => {
      mockAuthSuccess({ role: "ADMIN", organizationId: "o1" })
      ;(encryptSecret as any).mockImplementation(() => {
        throw new Error("FACTURACION_ENCRYPTION_KEY no configurada")
      })

      const { status, body } = await parseResponse(await PUT(putBody()))
      expect(status).toBe(500)
      expect(body.error).toMatch(/cifrado/i)
    })

    it("503 tier-A degradation when the upsert fails because migration 299 hasn't landed", async () => {
      mockAuthSuccess({ role: "ADMIN", organizationId: "o1" })
      const upsertSpy = vi.fn().mockResolvedValue({
        data: null,
        error: { code: "PGRST204", message: "Could not find the 'cert_pem_enc' column" },
      })
      mockSupabaseFrom({ facturacion_credenciales: { upsert: upsertSpy } as any })

      const { status, body } = await parseResponse(await PUT(putBody()))
      expect(status).toBe(503)
      expect(body.error).toBeDefined()
    })
  })
})
