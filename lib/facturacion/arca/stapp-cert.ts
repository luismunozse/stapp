/**
 * Certificado de la PLATAFORMA para el modelo de delegación.
 *
 * En delegación hay UN solo certificado —el de STApp— que emite en nombre de
 * todos los talleres que le delegaron el servicio de Facturación Electrónica.
 * Ese certificado NO es dato de un tenant, así que no vive en
 * `facturacion_credenciales` (que es por organización) sino en variables de
 * entorno:
 *
 *   ARCA_STAPP_CUIT      CUIT del certificado (11 dígitos)
 *   ARCA_STAPP_CERT_B64  el .crt en base64
 *   ARCA_STAPP_KEY_B64   la .key en base64
 *
 * Van en base64 porque un PEM es multilínea y las variables de entorno no lo
 * son de forma confiable en todas las plataformas.
 *
 * AFIP deriva la identidad del WSAA del subject de ESTE certificado; el CUIT
 * del taller viaja aparte, en `Auth.Cuit`. Ver `arca-direct-provider.ts`.
 */

import { validateCertKeyPair, CertValidationError } from "@/lib/facturacion/arca/cert"
import { clasificarPem } from "@/lib/facturacion/arca/pem-upload"

export class ArcaStappCertError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ArcaStappCertError"
  }
}

export interface CertificadoStapp {
  /** CUIT del certificado de la plataforma — keyea el ticket WSAA y el lease. */
  cuit: string
  certPem: string
  keyPem: string
  /** ISO 8601 — el gate de vencimiento vive en `access.ts`. */
  notAfter: string
  subject: string
}

let cache: CertificadoStapp | null = null

/** Solo para tests: el cache es a nivel módulo y sobrevive entre casos. */
export function resetCertificadoStappCache(): void {
  cache = null
}

function requerir(nombre: string): string {
  const valor = process.env[nombre]
  if (!valor) {
    throw new ArcaStappCertError(
      `${nombre} no configurada: la facturación delegada necesita el certificado de la plataforma`
    )
  }
  return valor
}

function decodificar(nombre: string): string {
  try {
    return Buffer.from(requerir(nombre), "base64").toString("utf8")
  } catch {
    throw new ArcaStappCertError(`${nombre} no es base64 válido`)
  }
}

/**
 * El par se valida UNA vez y se cachea: `validateCertKeyPair` parsea el X.509
 * y compara módulos, y esto se llama en cada emisión. Las variables de entorno
 * no cambian en caliente, así que revalidar sería puro costo.
 */
export function getCertificadoStapp(): CertificadoStapp {
  if (cache) return cache

  const cuit = requerir("ARCA_STAPP_CUIT").replace(/\D/g, "")
  const certPem = decodificar("ARCA_STAPP_CERT_B64")
  const keyPem = decodificar("ARCA_STAPP_KEY_B64")

  // Se chequea la forma ANTES de la validación criptográfica para que un
  // copy-paste cruzado (la clave donde va el certificado) diga exactamente
  // eso, en vez de un "PEM inválido" genérico.
  if (clasificarPem(certPem) !== "certificado") {
    throw new ArcaStappCertError(
      "ARCA_STAPP_CERT_B64 no contiene un certificado PEM (revisá si no pusiste el CSR o la clave)"
    )
  }
  if (clasificarPem(keyPem) !== "clave") {
    throw new ArcaStappCertError("ARCA_STAPP_KEY_B64 no contiene una clave privada PEM")
  }

  let validado
  try {
    validado = validateCertKeyPair({ certPem, keyPem, declaredCuit: cuit })
  } catch (e) {
    if (e instanceof CertValidationError) {
      throw new ArcaStappCertError(`Certificado de plataforma inválido (${e.code}): ${e.message}`)
    }
    throw new ArcaStappCertError("No se pudo validar el certificado de plataforma")
  }

  cache = {
    cuit: validado.cuit,
    certPem,
    keyPem,
    notAfter: validado.notAfter,
    subject: validado.subject,
  }
  return cache
}
