import { catalogoUrls } from "@/lib/sitemap-data"
import { urlsetXml, XML_HEADERS } from "@/lib/sitemap-xml"

// Catalogos publicos de los talleres. Va aparte del de marketing para poder
// medir la indexacion de cada poblacion por separado en Search Console.
export const revalidate = 3600

export async function GET() {
  return new Response(urlsetXml(await catalogoUrls()), { headers: XML_HEADERS })
}
