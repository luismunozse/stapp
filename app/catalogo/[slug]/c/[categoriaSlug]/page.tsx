import { notFound } from "next/navigation"
import Image from "next/image"
import Link from "next/link"
import { unstable_cache } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase"
import { CatalogoView } from "@/components/catalogo-public/catalogo-view"
import { CatalogoBreadcrumb } from "@/components/catalogo-public/catalogo-breadcrumb"
import { Button } from "@/components/ui/button"
import { Inbox, MessageCircle } from "lucide-react"
import type { Metadata, Viewport } from "next"

type PageProps = { params: Promise<{ slug: string; categoriaSlug: string }> }

const fetchCatalogo = unstable_cache(
  _fetchCatalogo,
  ["catalogo-public-categoria"],
  { revalidate: 60, tags: ["catalogo"] }
)

async function _fetchCatalogo(slug: string, categoriaSlug: string) {
  if (!/^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/.test(slug)) return null
  if (!/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/.test(categoriaSlug)) return null

  const { data: config } = await supabaseAdmin
    .from("catalogo_config")
    .select("slug, titulo, descripcion, color_primary, whatsapp, banner_url, trust_badges, activo, organization_id")
    .eq("slug", slug)
    .maybeSingle()

  if (!config || !config.activo) return null

  const { data: categoria } = await supabaseAdmin
    .from("catalogo_categorias")
    .select("id, nombre, slug, descripcion, imagen_url")
    .eq("organization_id", config.organization_id)
    .eq("slug", categoriaSlug)
    .eq("activo", true)
    .maybeSingle()

  if (!categoria) return null

  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("id, nombre, nombre_mostrar, logo_url, telefono, moneda")
    .eq("id", config.organization_id)
    .single()

  const { data: categorias } = await supabaseAdmin
    .from("catalogo_categorias")
    .select("id, nombre, slug, descripcion, imagen_url, orden")
    .eq("organization_id", config.organization_id)
    .eq("activo", true)
    .order("orden", { ascending: true })

  const { data: itemsRaw } = await supabaseAdmin
    .from("catalogo_items")
    .select(`
      id, tipo, nombre, descripcion, categoria_id, precio, precio_hasta, precio_lista,
      imagen_url, imagenes, etiquetas, stock, destacado, inventario_id, orden,
      inventario:inventario(stock),
      variantes:catalogo_variantes(id, etiqueta, sku, precio, stock, imagen_url, activo, orden)
    `)
    .eq("organization_id", config.organization_id)
    .eq("activo", true)
    .order("destacado", { ascending: false })
    .order("orden", { ascending: true })

  const ago7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: viewsRaw } = await supabaseAdmin
    .from("catalogo_views")
    .select("item_id, visitor_hash")
    .eq("organization_id", config.organization_id)
    .not("item_id", "is", null)
    .gte("created_at", ago7)
    .limit(10000)

  const viewsPorItem = new Map<string, Set<string>>()
  const viewsPorItemRaw = new Map<string, number>()
  for (const v of viewsRaw ?? []) {
    if (!v.item_id) continue
    viewsPorItemRaw.set(v.item_id, (viewsPorItemRaw.get(v.item_id) ?? 0) + 1)
    if (v.visitor_hash) {
      if (!viewsPorItem.has(v.item_id)) viewsPorItem.set(v.item_id, new Set())
      viewsPorItem.get(v.item_id)!.add(v.visitor_hash)
    }
  }

  // Top variante por item
  const itemIdsConVariantes = (itemsRaw ?? [])
    .filter((it: any) => (it.variantes ?? []).some((v: any) => v.activo))
    .map((it: any) => it.id)
  const topVariantePorItem = new Map<string, string>()
  if (itemIdsConVariantes.length > 0) {
    const { data: vRows } = await supabaseAdmin
      .from("items_cotizacion")
      .select("catalogo_item_id, variante_id")
      .in("catalogo_item_id", itemIdsConVariantes)
      .not("variante_id", "is", null)
      .limit(20000)
    const counts = new Map<string, Map<string, number>>()
    for (const r of vRows ?? []) {
      if (!r.catalogo_item_id || !r.variante_id) continue
      if (!counts.has(r.catalogo_item_id)) counts.set(r.catalogo_item_id, new Map())
      const m = counts.get(r.catalogo_item_id)!
      m.set(r.variante_id, (m.get(r.variante_id) ?? 0) + 1)
    }
    for (const [itemId, m] of counts.entries()) {
      let topId: string | null = null
      let topCount = 0
      for (const [vid, c] of m.entries()) {
        if (c > topCount) { topCount = c; topId = vid }
      }
      if (topId && topCount >= 2) topVariantePorItem.set(itemId, topId)
    }
  }

  const items = (itemsRaw ?? []).map((it: any) => {
    const variantesActivas = (it.variantes ?? [])
      .filter((v: any) => v.activo)
      .sort((a: any, b: any) => a.orden - b.orden)
    const tieneVariantes = variantesActivas.length > 0
    const stockVariantes = tieneVariantes
      ? variantesActivas.reduce((s: number | null, v: any) => {
          if (v.stock == null) return null
          return s == null ? null : s + v.stock
        }, 0)
      : null
    const stockReal = tieneVariantes
      ? stockVariantes
      : it.inventario_id && it.inventario ? it.inventario.stock : it.stock
    const precioMin = tieneVariantes
      ? variantesActivas.reduce((m: number | null, v: any) => {
          if (v.precio == null) return m
          return m == null ? Number(v.precio) : Math.min(m, Number(v.precio))
        }, null) ?? it.precio
      : it.precio
    const vistasUnicas = viewsPorItem.get(it.id)?.size ?? 0
    const vistasTotal = viewsPorItemRaw.get(it.id) ?? 0
    const topVarId = topVariantePorItem.get(it.id) ?? null
    const { inventario, variantes, ...rest } = it
    return {
      ...rest,
      precio: precioMin,
      stock_disponible: stockReal,
      vistas_semana: Math.max(vistasUnicas, vistasTotal),
      top_variante_id: topVarId,
      variantes: variantesActivas.map((v: any) => ({
        id: v.id,
        etiqueta: v.etiqueta,
        sku: v.sku,
        precio: v.precio,
        stock: v.stock,
        imagen_url: v.imagen_url,
      })),
    }
  })

  return {
    config: {
      slug: config.slug,
      titulo: config.titulo,
      descripcion: config.descripcion,
      color_primary: config.color_primary || "#2563eb",
      whatsapp: config.whatsapp,
      banner_url: config.banner_url,
      trust_badges: Array.isArray(config.trust_badges) ? config.trust_badges : [],
    },
    organizacion: org!,
    categoria,
    categorias: categorias ?? [],
    items,
  }
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

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: orgName,
        item: `/catalogo/${slug}`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: data.categoria.nombre,
        item: `/catalogo/${slug}/c/${categoriaSlug}`,
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
      url: `/catalogo/${slug}/${it.id}`,
      item: {
        "@type": it.tipo === "SERVICIO" ? "Service" : "Product",
        name: it.nombre,
        image: it.imagen_url || undefined,
        description: it.descripcion || undefined,
        ...(it.precio != null && {
          offers: {
            "@type": "Offer",
            price: Number(it.precio),
            priceCurrency: moneda,
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
              className="h-12 w-12 sm:h-20 sm:w-20 rounded-xl flex items-center justify-center text-xl sm:text-2xl shrink-0"
              style={{ backgroundColor: `${data.config.color_primary}15`, color: data.config.color_primary }}
            >
              📁
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
                    <MessageCircle className="h-4 w-4" />
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
