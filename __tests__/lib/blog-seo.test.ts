// @vitest-environment node
import { describe, it, expect } from "vitest"
import { blogPostingSchema } from "@/lib/blog-seo"

const base = {
  slug: "mejorar-experiencia-cliente-taller",
  title: "Cómo mejorar la experiencia del cliente",
  excerpt: "Buenas prácticas para fidelizar clientes en tu taller.",
  image: "https://images.unsplash.com/photo-1556742031-c6961e8560b0?w=800",
  date: "2024-01-15",
  category: "Gestión",
  keywords: ["experiencia del cliente", "taller reparación"],
}

describe("blogPostingSchema: structured data para posicionar el blog", () => {
  it("emite un BlogPosting válido de schema.org", () => {
    const s = blogPostingSchema(base)
    expect(s["@context"]).toBe("https://schema.org")
    expect(s["@type"]).toBe("BlogPosting")
    expect(s.headline).toBe(base.title)
    expect(s.description).toBe(base.excerpt)
  })

  it("ancla mainEntityOfPage y @id a la URL canónica del post", () => {
    const s = blogPostingSchema(base)
    const url = `https://stapp.com.ar/empresa/blog/${base.slug}`
    expect(s["@id"]).toBe(`${url}/#article`)
    expect(s.mainEntityOfPage).toEqual({ "@type": "WebPage", "@id": url })
  })

  it("datePublished usa la fecha del post y dateModified cae en date si no hay updatedAt", () => {
    const s = blogPostingSchema(base)
    expect(s.datePublished).toBe("2024-01-15")
    expect(s.dateModified).toBe("2024-01-15")
  })

  it("dateModified usa updatedAt cuando está presente (señal de frescura)", () => {
    const s = blogPostingSchema({ ...base, updatedAt: "2026-07-22" })
    expect(s.datePublished).toBe("2024-01-15")
    expect(s.dateModified).toBe("2026-07-22")
  })

  it("author y publisher son STApp (Organization) con logo", () => {
    const s = blogPostingSchema(base)
    expect(s.author).toMatchObject({ "@type": "Organization", name: "STApp" })
    expect(s.publisher).toMatchObject({
      "@type": "Organization",
      name: "STApp",
      logo: { "@type": "ImageObject" },
    })
  })

  it("normaliza imágenes relativas a URL absoluta y deja las absolutas intactas", () => {
    const abs = blogPostingSchema(base)
    expect(abs.image).toBe(base.image)

    const rel = blogPostingSchema({ ...base, image: "/screenshots/desktop/ordenes.png" })
    expect(rel.image).toBe("https://stapp.com.ar/screenshots/desktop/ordenes.png")
  })

  it("incluye articleSection, keywords como string e idioma es-AR", () => {
    const s = blogPostingSchema(base)
    expect(s.articleSection).toBe("Gestión")
    expect(s.keywords).toBe("experiencia del cliente, taller reparación")
    expect(s.inLanguage).toBe("es-AR")
  })
})
