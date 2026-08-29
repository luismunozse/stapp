import { describe, it, expect } from "vitest"
import { urlsetXml, sitemapIndexXml } from "@/lib/sitemap-xml"

/**
 * El XML lo parsea Google, no un humano: un `&` sin escapar o un `<lastmod>`
 * invalido invalidan el sitemap entero y se pierden TODAS las URLs, no la que
 * tiene el error. Por eso se testea la serializacion y no solo los datos.
 */
describe("urlsetXml", () => {
  it("emite un urlset valido", () => {
    const xml = urlsetXml([{ url: "https://stapp.com.ar/precios" }])

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(xml).toContain("<loc>https://stapp.com.ar/precios</loc>")
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true)
  })

  it("escapa los caracteres que romperian el XML", () => {
    // Los slugs de catalogo y los ids salen de la base; un & en una URL sin
    // escapar tira abajo el sitemap completo.
    const xml = urlsetXml([{ url: "https://stapp.com.ar/catalogo/a?x=1&y=2" }])

    expect(xml).toContain("&amp;")
    expect(xml).not.toMatch(/[^&]&(?!amp;|lt;|gt;|quot;|apos;)/)
  })

  it("emite lastmod en ISO", () => {
    const xml = urlsetXml([
      { url: "https://stapp.com.ar/", lastModified: new Date("2026-08-28T12:00:00Z") },
    ])

    expect(xml).toContain("<lastmod>2026-08-28T12:00:00.000Z</lastmod>")
  })

  it("omite un lastmod invalido en vez de emitir basura", () => {
    // `new Date(undefined)` y las fechas rotas de la base no deben terminar
    // como <lastmod>Invalid Date</lastmod>, que invalida el documento.
    const xml = urlsetXml([
      { url: "https://stapp.com.ar/", lastModified: new Date("no-es-fecha") },
    ])

    expect(xml).not.toContain("Invalid Date")
    expect(xml).not.toContain("<lastmod>")
    expect(xml).toContain("<loc>")
  })

  it("omite los campos opcionales que no vienen", () => {
    const xml = urlsetXml([{ url: "https://stapp.com.ar/" }])

    expect(xml).not.toContain("<changefreq>")
    expect(xml).not.toContain("<priority>")
  })

  it("incluye changefreq y priority cuando vienen", () => {
    const xml = urlsetXml([
      { url: "https://stapp.com.ar/", changeFrequency: "weekly", priority: 1 },
    ])

    expect(xml).toContain("<changefreq>weekly</changefreq>")
    expect(xml).toContain("<priority>1</priority>")
  })

  it("emite priority 0 en vez de tragarselo por falsy", () => {
    const xml = urlsetXml([{ url: "https://stapp.com.ar/", priority: 0 }])

    expect(xml).toContain("<priority>0</priority>")
  })
})

describe("sitemapIndexXml", () => {
  it("emite un sitemapindex, no un urlset", () => {
    const xml = sitemapIndexXml([{ url: "https://stapp.com.ar/sitemap-marketing.xml" }])

    expect(xml).toContain("<sitemapindex")
    expect(xml).not.toContain("<urlset")
    expect(xml).toContain("<sitemap>")
    expect(xml).toContain("<loc>https://stapp.com.ar/sitemap-marketing.xml</loc>")
  })

  it("lista los dos hijos", () => {
    const xml = sitemapIndexXml([
      { url: "https://stapp.com.ar/sitemap-marketing.xml" },
      { url: "https://stapp.com.ar/sitemap-catalogos.xml" },
    ])

    expect(xml.match(/<sitemap>/g)).toHaveLength(2)
  })
})
