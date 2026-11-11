import { describe, it, expect } from "vitest"
import { serializeJsonLd } from "@/lib/seo/serialize-json-ld"

const LS = String.fromCharCode(0x2028)
const PS = String.fromCharCode(0x2029)

describe("serializeJsonLd", () => {
  it("no deja cerrar el <script> con datos del tenant", () => {
    const out = serializeJsonLd({ name: '</script><script>alert(1)</script>' })
    expect(out).not.toMatch(/<\/script/i)
    expect(out).not.toContain("<")
  })

  it("escapa > y & para no abrir comentarios HTML ni entidades", () => {
    const out = serializeJsonLd({ name: "<!-- a & b -->" })
    expect(out).not.toContain("<")
    expect(out).not.toContain(">")
    expect(out).not.toContain("&")
  })

  it("escapa los separadores de línea U+2028 y U+2029", () => {
    const out = serializeJsonLd({ name: `a${LS}b${PS}c` })
    expect(out).not.toContain(LS)
    expect(out).not.toContain(PS)
  })

  it("sigue siendo JSON válido que se parsea al objeto original", () => {
    const original = {
      "@context": "https://schema.org",
      name: `</script><img src=x onerror=alert(1)> & "comillas" ${LS}`,
      offers: { price: 1234.5, priceCurrency: "ARS" },
    }
    expect(JSON.parse(serializeJsonLd(original))).toEqual(original)
  })
})
