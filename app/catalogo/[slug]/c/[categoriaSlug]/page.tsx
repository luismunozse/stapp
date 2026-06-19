import { notFound } from "next/navigation"
import Image from "next/image"
import Link from "next/link"
import { unstable_cache } from "next/cache"
import { CatalogoView } from "@/components/catalogo-public/catalogo-view"
import { CatalogoBreadcrumb } from "@/components/catalogo-public/catalogo-breadcrumb"
import { Button } from "@/components/ui/button"
import { Inbox } from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import { fetchCatalogoBaseData } from "@/lib/catalogo/fetch-data"
import type { Metadata, Viewport } from "next"

type PageProps = { params: Promise<{ slug: string; categoriaSlug: string }> }

const CATEGORIA_SLUG_REGEX = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/

// Reusa fetchCatalogoBaseData y agrega la categoría (filtro se aplica luego
// en cliente vía CatalogoView con initialCategoriaId). El cache wrapper queda
// por separado para mantener tag granular por (slug, categoriaSlug).
function fetchCatalogo(slug: string, categoriaSlug: string) {
  return unstable_cache(
    () => _fetchCatalogo(slug, categoriaSlug),
    ["catalogo-public-categoria", slug, categoriaSlug],
    { revalidate: 60, tags: ["catalogo", `catalogo:${slug}`, `catalogo:${slug}:cat:${categoriaSlug}`] }
  )()
}

async function _fetchCatalogo(slug: string, categoriaSlug: string) {
  if (!CATEGORIA_SLUG_REGEX.test(categoriaSlug)) return null
  const base = await fetchCatalogoBaseData(slug)
  if (!base) return null

  const categoria = base.categorias.find(
    (c) => c.slug === categoriaSlug || c.id === categoriaSlug
  )
  if (!categoria) return null

  return { ...base, categoria }
}

export async function generateViewport({ params }: PageProps): Promise<Viewport> {
  const { slug, categoriaSlug } = await params
  const data = await fetchCatalogo(slug, categoriaSlug)
  return { themeColor: data?.config.color_primary || "#2563eb" }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, categoriaSlug } = await params
  const data = await fetchCatalogo(slug, categoriaSlug)
  if (!data) return { title: "Categoría no encontrada" }

  const orgName = data.organizacion.nombre_mostrar || data.organizacion.nombre
  const titulo = `${data.categoria.nombre} — ${orgName}`
  const descripcion =
    data.categoria.descripcion ||
    `${data.categoria.nombre} disponibles en el catálogo de ${orgName}. Ver precios, stock y solicitar cotización online.`

  return {
    title: titulo,
    description: descripcion,
    alternates: {
      canonical: `/catalogo/${slug}/c/${categoriaSlug}`,
    },
    openGraph: {
      title: titulo,
      description: descripcion,
      type: "website",
      images: data.categoria.imagen_url ? [data.categoria.imagen_url] : undefined,
    },
  }
}

export default async function CatalogoCategoriaPage({ params }: PageProps) {
  const { slug, categoriaSlug } = await params
  const data = await fetchCatalogo(slug, categoriaSlug)
  if (!data) notFound()

  const orgName = data.organizacion.nombre_mostrar || data.organizacion.nombre
  const moneda = data.organizacion.moneda || "ARS"
  const itemsCategoria = data.items.filter((i: any) => i.categoria_id === data.categoria.id)

  // URLs absolutas para schema.org + priceValidUntil.
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || ""
  const abs = (p: string) => (baseUrl ? `${baseUrl}${p}` : p)
  const priceValidUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: orgName,
        item: abs(`/catalogo/${slug}`),
      },
      {
        "@type": "ListItem",
        position: 2,
        name: data.categoria.nombre,
        item: abs(`/catalogo/${slug}/c/${categoriaSlug}`),
      },
    ],
  }

  const itemListLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${data.categoria.nombre} — ${orgName}`,
    numberOfItems: itemsCategoria.length,
    itemListElement: itemsCategoria.slice(0, 50).map((it: any, i: number) => ({
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListLd) }}
      />
      <CatalogoBreadcrumb
        items={[
          { label: orgName, href: `/catalogo/${slug}` },
          { label: data.categoria.nombre },
        ]}
      />
      <section className="container mx-auto max-w-6xl px-4 pt-4 pb-2">
        <div className="rounded-2xl border bg-card overflow-hidden flex items-center gap-3 sm:gap-4 p-3 sm:p-5">
          {data.categoria.imagen_url ? (
            <div className="relative h-12 w-12 sm:h-20 sm:w-20 rounded-xl overflow-hidden bg-muted shrink-0">
              <Image
                src={data.categoria.imagen_url}
                alt={data.categoria.nombre}
                fill
                sizes="80px"
                className="object-cover"
              />
            </div>
          ) : (
            <div
              className="h-12 w-12 sm:h-20 sm:w-20 rounded-xl flex items-center justify-center text-2xl sm:text-4xl font-bold shrink-0"
              style={{ backgroundColor: `${data.config.color_primary}15`, color: data.config.color_primary }}
            >
              {data.categoria.nombre.match(/[a-z0-9]/i)?.[0]?.toUpperCase() ?? "•"}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-lg sm:text-2xl font-bold leading-tight">{data.categoria.nombre}</h2>
            {data.categoria.descripcion && (
              <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1 line-clamp-2">{data.categoria.descripcion}</p>
            )}
            <p className="text-[11px] sm:text-xs text-muted-foreground mt-1">
              {itemsCategoria.length} {itemsCategoria.length === 1 ? "item" : "items"}
            </p>
          </div>
        </div>
      </section>
      {itemsCategoria.length === 0 ? (
        <main className="container mx-auto max-w-6xl px-4 py-12 sm:py-16">
          <div className="max-w-md mx-auto text-center">
            <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Inbox className="h-10 w-10 text-muted-foreground opacity-50" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Sin items en esta categoría</h3>
            <p className="text-sm text-muted-foreground mb-6">
              {orgName} todavía no publicó productos o servicios en{" "}
              <span className="font-medium text-foreground">{data.categoria.nombre}</span>.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button asChild variant="outline">
                <Link href={`/catalogo/${slug}`}>← Ver catálogo completo</Link>
              </Button>
              {data.config.whatsapp && (
                <Button
                  asChild
                  className="gap-1.5 text-white"
                  style={{ backgroundColor: data.config.color_primary }}
                >
                  <a
                    href={`https://wa.me/${data.config.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(
                      `Hola! Estoy buscando algo en "${data.categoria.nombre}". ¿Tienen disponibilidad?`
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <WhatsAppIcon className="h-4 w-4" />
                    Consultar por WhatsApp
                  </a>
                </Button>
              )}
            </div>
          </div>
        </main>
      ) : (
        <CatalogoView data={data} initialCategoriaId={data.categoria.id} />
      )}
    </>
  )
}
