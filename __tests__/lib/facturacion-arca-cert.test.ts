import { describe, it, expect } from "vitest"
import { validateCertKeyPair, CertValidationError } from "@/lib/facturacion/arca/cert"
import { CERT_A, KEY_A, CERT_B, KEY_B, CUIT_A, CUIT_B } from "./facturacion-arca-cert-fixture"

describe("validateCertKeyPair", () => {
  it("returns parsed metadata for a matching cert/key pair with the declared CUIT", () => {
    const result = validateCertKeyPair({ certPem: CERT_A, keyPem: KEY_A, declaredCuit: CUIT_A })

    expect(result.cuit).toBe(CUIT_A)
    expect(result.subject).toContain("CUIT 20123456789")
    expect(result.fingerprint).toMatch(/^[0-9A-F:]+$/)
    expect(new Date(result.notAfter).getTime()).toBeGreaterThan(Date.now())
    expect(new Date(result.notBefore).getTime()).toBeLessThan(Date.now())
  })

  it("rejects a cert/key pair whose RSA modulus does not match", () => {
    expect(() => validateCertKeyPair({ certPem: CERT_A, keyPem: KEY_B, declaredCuit: CUIT_A })).toThrow(
      CertValidationError
    )
    try {
      validateCertKeyPair({ certPem: CERT_A, keyPem: KEY_B, declaredCuit: CUIT_A })
    } catch (e) {
      expect((e as CertValidationError).code).toBe("MODULUS_MISMATCH")
    }
  })

  it("rejects when the cert's CUIT differs from the declared CUIT", () => {
    expect(() => validateCertKeyPair({ certPem: CERT_A, keyPem: KEY_A, declaredCuit: CUIT_B })).toThrow(
      CertValidationError
    )
    try {
      validateCertKeyPair({ certPem: CERT_A, keyPem: KEY_A, declaredCuit: CUIT_B })
    } catch (e) {
      expect((e as CertValidationError).code).toBe("CUIT_MISMATCH")
      expect((e as CertValidationError).message).toContain(CUIT_B)
    }
  })

  it("rejects malformed PEM input with an actionable error, not an unhandled throw type", () => {
    try {
      validateCertKeyPair({ certPem: "not a pem", keyPem: KEY_A, declaredCuit: CUIT_A })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(CertValidationError)
      expect((e as CertValidationError).code).toBe("INVALID_PEM")
    }
  })

})
