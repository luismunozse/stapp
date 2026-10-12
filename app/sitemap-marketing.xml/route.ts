import { marketingUrls } from "@/lib/sitemap-data"
import { urlsetXml, XML_HEADERS } from "@/lib/sitemap-xml"

// Paginas propias: landing, precios, blog, casos de uso, legales, ayuda.
export const revalidate = 3600

export function GET() {
  return new Response(urlsetXml(marketingUrls()), { headers: XML_HEADERS })
}
