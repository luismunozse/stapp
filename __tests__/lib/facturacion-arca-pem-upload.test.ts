import { describe, it, expect } from "vitest"

import { clasificarPem, leerArchivoComoTexto } from "@/lib/facturacion/arca/pem-upload"

const CERT = "-----BEGIN CERTIFICATE-----\nMIID\n-----END CERTIFICATE-----\n"
const KEY_PKCS1 = "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----\n"
const KEY_PKCS8 = "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n"
const CSR = "-----BEGIN CERTIFICATE REQUEST-----\nMIIC\n-----END CERTIFICATE REQUEST-----\n"

describe("clasificarPem", () => {
  it("reconoce un certificado", () => {
    expect(clasificarPem(CERT)).toBe("certificado")
  })

  it("reconoce una clave privada en PKCS#1 y en PKCS#8", () => {
    expect(clasificarPem(KEY_PKCS1)).toBe("clave")
    expect(clasificarPem(KEY_PKCS8)).toBe("clave")
  })

  /**
   * El error más común del onboarding: WSASS devuelve el certificado, pero
   * el usuario tiene el `.csr` al lado en la misma carpeta y sube ese. Sin
   * distinguirlo, el servidor responde "no es un PEM X.509 válido" y nadie
   * entiende por qué.
   */
  it("distingue la solicitud (CSR) del certificado", () => {
    expect(clasificarPem(CSR)).toBe("solicitud")
  })

  it("devuelve desconocido ante cualquier otra cosa", () => {
    expect(clasificarPem("no soy un pem")).toBe("desconocido")
    expect(clasificarPem("")).toBe("desconocido")
  })

  it("tolera espacios y saltos de línea alrededor", () => {
    expect(clasificarPem(`\n\n   ${CERT}   \n`)).toBe("certificado")
  })
})

describe("leerArchivoComoTexto", () => {
  it("devuelve el contenido del archivo", async () => {
    const file = new File([CERT], "stapp-homo.crt", { type: "application/x-x509-ca-cert" })
    await expect(leerArchivoComoTexto(file)).resolves.toBe(CERT)
  })

  /**
   * Un FileReader sin `onerror` deja la promesa colgada para siempre y el
   * botón queda en "Conectando..." sin decir nada.
   */
  it("rechaza en vez de colgarse si la lectura falla", async () => {
    const roto = {
      name: "roto.crt",
      // `FileReader.readAsText` sobre algo que no es Blob tira TypeError.
    } as unknown as File

    await expect(leerArchivoComoTexto(roto)).rejects.toThrow()
  })
})
