import type { MetadataRoute } from "next"

/**
 * Serializacion manual del XML.
 *
 * El convention file `app/sitemap.ts` de Next solo emite un `<urlset>`, y para
 * partir el sitemap hace falta ademas un `<sitemapindex>`. Estas rutas se
 * escriben a mano para poder emitir los dos formatos y, sobre todo, para que
 * `/sitemap.xml` siga siendo la URL de entrada: ya esta enviada a Search
 * Console, y como indice arrastra a los hijos sin que haya que reenviar nada.
 */

function escapar(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function fecha(valor: Date | string | undefined): string | null {
  if (!valor) return null
  const d = valor instanceof Date ? valor : new Date(valor)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function urlsetXml(entradas: MetadataRoute.Sitemap): string {
  const cuerpo = entradas
    .map((e) => {
      const partes = [`    <loc>${escapar(String(e.url))}</loc>`]
      const mod = fecha(e.lastModified as Date | string | undefined)
      if (mod) partes.push(`    <lastmod>${mod}</lastmod>`)
      if (e.changeFrequency) partes.push(`    <changefreq>${e.changeFrequency}</changefreq>`)
      if (e.priority !== undefined) partes.push(`    <priority>${e.priority}</priority>`)
      return `  <url>\n${partes.join("\n")}\n  </url>`
    })
    .join("\n")

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${cuerpo}\n</urlset>\n`
}

export function sitemapIndexXml(sitemaps: { url: string; lastModified?: Date }[]): string {
  const cuerpo = sitemaps
    .map((s) => {
      const partes = [`    <loc>${escapar(s.url)}</loc>`]
      const mod = fecha(s.lastModified)
      if (mod) partes.push(`    <lastmod>${mod}</lastmod>`)
      return `  <sitemap>\n${partes.join("\n")}\n  </sitemap>`
    })
    .join("\n")

  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${cuerpo}\n</sitemapindex>\n`
}

export const XML_HEADERS = {
  "Content-Type": "application/xml; charset=utf-8",
  // Los catalogos cambian seguido; una hora de cache alcanza y evita pegarle
  // a la base en cada rastreo.
  "Cache-Control": "public, max-age=3600, s-maxage=3600",
} as const
