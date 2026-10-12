/**
 * Validación de certificado/clave X.509 para credenciales del proveedor
 * ARCA directo (design ADR-14). Usa exclusivamente `crypto.X509Certificate`
 * (Node >= 15.6): `checkPrivateKey()` es exactamente el chequeo de módulo
 * que necesitamos, sin sumar una dependencia nueva (ni siquiera `node-forge`,
 * que hoy no es una dependencia real del proyecto — solo lo sería de forma
 * transitiva una vez instalado `@arcasdk/core`, todavía pendiente del spike
 * de homologación).
 */

import { X509Certificate, createPrivateKey } from "crypto"

export type CertValidationErrorCode = "INVALID_PEM" | "MODULUS_MISMATCH" | "CUIT_MISMATCH" | "CUIT_NOT_FOUND"

export class CertValidationError extends Error {
  code: CertValidationErrorCode

  constructor(code: CertValidationErrorCode, message: string) {
    super(message)
    this.name = "CertValidationError"
    this.code = code
  }
}

export interface CertValidationInput {
  certPem: string
  keyPem: string
  /** CUIT declarado por la org (sin guiones), a comparar contra el `serialNumber` del subject. */
  declaredCuit: string
}

export interface CertValidationResult {
  /** CUIT extraído del subject del certificado (coincide con `declaredCuit`). */
  cuit: string
  /** DN completo del certificado, para mostrar en la UI de configuración. */
  subject: string
  /** SHA-256 fingerprint, formato `AA:BB:...`. */
  fingerprint: string
  /** ISO 8601 — inicio de validez del certificado. */
  notBefore: string
  /** ISO 8601 — fin de validez del certificado. */
  notAfter: string
}

// AFIP embebe el CUIT en el subject como `serialNumber=CUIT <11 dígitos>`
// (RFC 4514 usa `,` como separador de RDNs, pero X509Certificate#subject de
// Node lo devuelve como texto con un RDN por línea).
const CUIT_IN_SUBJECT = /serialNumber=CUIT\s*(\d{11})/i

function parseCertificate(certPem: string): X509Certificate {
  try {
    return new X509Certificate(certPem)
  } catch (e) {
    throw new CertValidationError(
      "INVALID_PEM",
      `El certificado no es un PEM X.509 válido: ${e instanceof Error ? e.message : String(e)}`
    )
  }
}

function extractCuit(subject: string): string {
  const match = CUIT_IN_SUBJECT.exec(subject)
  if (!match) {
    throw new CertValidationError(
      "CUIT_NOT_FOUND",
      "El certificado no tiene un CUIT en el subject (esperado 'serialNumber=CUIT <11 dígitos>')"
    )
  }
  return match[1]
}

/**
 * Valida que `certPem`/`keyPem` formen un par válido (mismo módulo RSA) y
 * que el CUIT embebido en el certificado coincida con `declaredCuit`.
 * Lanza `CertValidationError` con un código accionable; no persiste nada.
 */
export function validateCertKeyPair(input: CertValidationInput): CertValidationResult {
  const cert = parseCertificate(input.certPem)

  let key
  try {
    key = createPrivateKey(input.keyPem)
  } catch (e) {
    throw new CertValidationError(
      "INVALID_PEM",
      `La clave privada no es un PEM válido: ${e instanceof Error ? e.message : String(e)}`
    )
  }

  if (!cert.checkPrivateKey(key)) {
    throw new CertValidationError(
      "MODULUS_MISMATCH",
      "El certificado y la clave privada no forman un par válido (el módulo RSA no coincide)"
    )
  }

  const cuit = extractCuit(cert.subject)
  if (cuit !== input.declaredCuit) {
    throw new CertValidationError(
      "CUIT_MISMATCH",
      `El CUIT del certificado (${cuit}) no coincide con el CUIT declarado (${input.declaredCuit})`
    )
  }

  return {
    cuit,
    subject: cert.subject,
    fingerprint: cert.fingerprint256,
    notBefore: new Date(cert.validFrom).toISOString(),
    notAfter: new Date(cert.validTo).toISOString(),
  }
}
