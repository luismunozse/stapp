import { notFound } from "next/navigation"
import { unstable_cache } from "next/cache"
import { CatalogoView } from "@/components/catalogo-public/catalogo-view"
import { fetchCatalogoBaseData } from "@/lib/catalogo/fetch-data"
import type { Metadata, Viewport } from "next"

type PageProps = { params: Promise<{ slug: string }> }

// Cache key incluye el slug para invalidación granular por tenant.
// Tag `catalogo:${slug}` permite invalidar un solo catálogo desde admin.
function fetchCatalogo(slug: string) {
  return unstable_cache(
    () => fetchCatalogoBaseData(slug),
    ["catalogo-public", slug],
    { revalidate: 60, tags: ["catalogo", `catalogo:${slug}`] }
  )()
}

export async function generateViewport({ params }: PageProps): Promise<Viewport> {
  const { slug } = await params
  const data = await fetchCatalogo(slug)
  return {
    themeColor: data?.config.color_primary || "#2563eb",
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const data = await fetchCatalogo(slug)
  if (!data) return { title: "Catálogo no encontrado" }

  const titulo = data.config.titulo || data.organizacion.nombre_mostrar || data.organizacion.nombre
  const descripcion = data.config.descripcion || `Catálogo de productos y servicios de ${titulo}`

  // OG image se genera automáticamente desde opengraph-image.tsx en este mismo dir
  return {
    title: titulo,
    description: descripcion,
    manifest: `/catalogo/${slug}/manifest.webmanifest`,
    alternates: {
      canonical: `/catalogo/${slug}`,
    },
    appleWebApp: {
      capable: true,
      title: titulo.length > 20 ? titulo.slice(0, 20) : titulo,
      statusBarStyle: "default",
    },
    openGraph: {
      title: titulo,
      description: descripcion,
      type: "website",
      url: `/catalogo/${slug}`,
    },
  }
}

export default async function CatalogoPublicPage({ params }: PageProps) {
  const { slug } = await params
  const data = await fetchCatalogo(slug)
  if (!data) notFound()

  const orgName = data.organizacion.nombre_mostrar || data.organizacion.nombre
  const moneda = data.organizacion.moneda || "ARS"
  const titulo = data.config.titulo || orgName

  // URL absoluta requerida por schema.org (Google la pide para indexación).
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || ""
  const abs = (p: string) => (baseUrl ? `${baseUrl}${p}` : p)
  // priceValidUntil: ~30 días desde hoy (Google exige fecha futura para Offer).
  const priceValidUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)

  // ItemList JSON-LD para SEO (Google Shopping snippets / rich results)
  const itemListLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: titulo,
    numberOfItems: data.items.length,
    itemListElement: data.items.slice(0, 50).map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: abs(`/catalogo/${slug}/${it.id}`),
      item: {
        "@type": it.tipo === "SERVICIO" ? "Service" : "Product",
        name: it.nombre,
        sku: it.id,
        image: it.imagen_url || undefined,
        description: it.descripcion || undefined,
        ...(it.precio != null && {
          offers: {
            "@type": "Offer",
            price: Number(it.precio),
            priceCurrency: moneda,
            priceValidUntil,
            url: abs(`/catalogo/${slug}/${it.id}`),
            availability:
              it.stock_disponible === 0
                ? "https://schema.org/OutOfStock"
                : "https://schema.org/InStock",
            ...(it.precio_lista != null &&
              Number(it.precio_lista) > Number(it.precio) && {
                priceSpecification: {
                  "@type": "UnitPriceSpecification",
                  priceType: "https://schema.org/ListPrice",
                  price: Number(it.precio_lista),
                  priceCurrency: moneda,
                },
              }),
          },
        }),
      },
    })),
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListLd) }}
      />
      <CatalogoView data={data} />
    </>
  )
}
