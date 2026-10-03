import { describe, it, expect } from "vitest"
import { normalizarWhatsAppCatalogo, catalogoWhatsAppUrl } from "@/lib/catalogo/whatsapp"

describe("normalizarWhatsAppCatalogo", () => {
  it("antepone el código de país a un número argentino local", () => {
    expect(normalizarWhatsAppCatalogo("11 1234-5678", "AR")).toBe("541112345678")
  })

  it("respeta un número que ya trae +54 9", () => {
    expect(normalizarWhatsAppCatalogo("+54 9 11 1234-5678", "AR")).toBe("5491112345678")
  })

  it("es idempotente", () => {
    const una = normalizarWhatsAppCatalogo("11 1234-5678", "AR")
    expect(normalizarWhatsAppCatalogo(una, "AR")).toBe(una)
  })

  it("usa el código del país de la organización (Chile)", () => {
    expect(normalizarWhatsAppCatalogo("9 1234 5678", "CL")).toBe("56912345678")
  })

  it("devuelve null si no hay dígitos suficientes (falta código de área)", () => {
    expect(normalizarWhatsAppCatalogo("1234-5678", "AR")).toBeNull()
  })

  it("devuelve null para vacío o nulo", () => {
    expect(normalizarWhatsAppCatalogo("", "AR")).toBeNull()
    expect(normalizarWhatsAppCatalogo(null, "AR")).toBeNull()
    expect(normalizarWhatsAppCatalogo("abc", "AR")).toBeNull()
  })
})

describe("catalogoWhatsAppUrl", () => {
  it("arma el link sin texto", () => {
    expect(catalogoWhatsAppUrl("541112345678")).toBe("https://wa.me/541112345678")
  })

  it("arma el link con texto codificado", () => {
    expect(catalogoWhatsAppUrl("541112345678", "Hola mundo")).toBe(
      "https://wa.me/541112345678?text=Hola%20mundo"
    )
  })

  it("devuelve null si no hay número", () => {
    expect(catalogoWhatsAppUrl(null, "x")).toBeNull()
    expect(catalogoWhatsAppUrl("", "x")).toBeNull()
  })
})
