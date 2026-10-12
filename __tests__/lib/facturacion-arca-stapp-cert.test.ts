import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/facturacion/arca/cert", async () => {
  const actual = await vi.importActual<typeof import("@/lib/facturacion/arca/cert")>(
    "@/lib/facturacion/arca/cert"
  )
  return { ...actual, validateCertKeyPair: vi.fn() }
})

import { validateCertKeyPair, CertValidationError } from "@/lib/facturacion/arca/cert"
import {
  getCertificadoStapp,
  resetCertificadoStappCache,
  ArcaStappCertError,
} from "@/lib/facturacion/arca/stapp-cert"

const CERT = "-----BEGIN CERTIFICATE-----\nMIID\n-----END CERTIFICATE-----\n"
const KEY = "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----\n"

const VALIDADO = {
  cuit: "23944498389",
  subject: "CN=stapp-prod, serialNumber=CUIT 23944498389",
  fingerprint: "AA:BB:CC",
  notBefore: "2026-09-13T22:16:31.000Z",
  notAfter: "2028-09-12T22:16:31.000Z",
}

function b64(s: string) {
  return Buffer.from(s, "utf8").toString("base64")
}

function setEnv(over: Record<string, string | undefined> = {}) {
  const base: Record<string, string | undefined> = {
    ARCA_STAPP_CUIT: "23944498389",
    ARCA_STAPP_CERT_B64: b64(CERT),
    ARCA_STAPP_KEY_B64: b64(KEY),
    ...over,
  }
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

describe("getCertificadoStapp", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetCertificadoStappCache()
    ;(validateCertKeyPair as any).mockReturnValue(VALIDADO)
    setEnv()
  })

  it("decodifica el certificado y la clave desde base64", () => {
    const cert = getCertificadoStapp()

    expect(cert.cuit).toBe("23944498389")
    expect(cert.certPem).toBe(CERT)
    expect(cert.keyPem).toBe(KEY)
    expect(cert.notAfter).toBe(VALIDADO.notAfter)
  })

  /**
   * El par se valida una sola vez: `validateCertKeyPair` parsea X.509 y
   * compara módulos, y esto se llama en cada emisión.
   */
  it("valida el par una sola vez y cachea el resultado", () => {
    getCertificadoStapp()
    getCertificadoStapp()
    getCertificadoStapp()

    expect(validateCertKeyPair).toHaveBeenCalledTimes(1)
  })

  it.each(["ARCA_STAPP_CUIT", "ARCA_STAPP_CERT_B64", "ARCA_STAPP_KEY_B64"])(
    "falla con un error propio si falta %s",
    (faltante) => {
      setEnv({ [faltante]: undefined })
      expect(() => getCertificadoStapp()).toThrow(ArcaStappCertError)
    }
  )

  /**
   * Un CUIT que no coincide con el del certificado significa que alguien
   * cargó mal una de las dos variables. Emitir así haría que AFIP rechace
   * todo sin explicar por qué.
   */
  it("propaga el fallo si el CUIT declarado no coincide con el del certificado", () => {
    ;(validateCertKeyPair as any).mockImplementation(() => {
      throw new CertValidationError("CUIT_MISMATCH", "el CUIT no coincide")
    })
    expect(() => getCertificadoStapp()).toThrow(ArcaStappCertError)
  })

  it("falla si el contenido decodificado no es un PEM de certificado", () => {
    setEnv({ ARCA_STAPP_CERT_B64: b64("cualquier cosa") })
    expect(() => getCertificadoStapp()).toThrow(ArcaStappCertError)
  })

  it("falla si lo que viene como clave es en realidad un certificado", () => {
    setEnv({ ARCA_STAPP_KEY_B64: b64(CERT) })
    expect(() => getCertificadoStapp()).toThrow(ArcaStappCertError)
  })
})
