import { SITE_URL } from "@/lib/sitemap-data"
import { sitemapIndexXml, XML_HEADERS } from "@/lib/sitemap-xml"

// Indice. Se mantiene en /sitemap.xml a proposito: es la URL ya enviada a
// Search Console, asi que los dos sitemaps hijos se descubren solos sin tener
// que reenviar nada.
export const revalidate = 3600

export function GET() {
  const ahora = new Date()
  return new Response(
    sitemapIndexXml([
      { url: `${SITE_URL}/sitemap-marketing.xml`, lastModified: ahora },
      { url: `${SITE_URL}/sitemap-catalogos.xml`, lastModified: ahora },
    ]),
    { headers: XML_HEADERS }
  )
}
