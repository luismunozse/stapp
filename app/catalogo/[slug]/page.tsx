import { notFound } from "next/navigation"
import { unstable_cache } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase"
import { CatalogoView } from "@/components/catalogo-public/catalogo-view"
import type { Metadata, Viewport } from "next"

type PageProps = { params: Promise<{ slug: string }> }

const fetchCatalogo = unstable_cache(
  _fetchCatalogo,
  ["catalogo-public"],
  { revalidate: 60, tags: ["catalogo"] }
)

async function _fetchCatalogo(slug: string) {
  if (!/^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/.test(slug)) return null

  const { data: config } = await supabaseAdmin
    .from("catalogo_config")
    .select("slug, titulo, descripcion, color_primary, whatsapp, banner_url, trust_badges, activo, organization_id")
    .eq("slug", slug)
    .maybeSingle()

  if (!config || !config.activo) return null

  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("id, nombre, nombre_mostrar, logo_url, telefono, moneda")
    .eq("id", config.organization_id)
    .single()

  const { data: categorias } = await supabaseAdmin
    .from("catalogo_categorias")
    .select("id, nombre, descripcion, imagen_url, orden")
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

  // Social proof: vistas únicas (por visitor_hash) por item últimos 7 días
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
    const { inventario, variantes, ...rest } = it
    return {
      ...rest,
      precio: precioMin,
      stock_disponible: stockReal,
      vistas_semana: Math.max(vistasUnicas, vistasTotal),
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
    categorias: categorias ?? [],
    items,
  }
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
    appleWebApp: {
      capable: true,
      title: titulo.length > 20 ? titulo.slice(0, 20) : titulo,
      statusBarStyle: "default",
    },
    openGraph: {
      title: titulo,
      description: descripcion,
      type: "website",
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

  // ItemList JSON-LD para SEO (Google Shopping snippets / rich results)
  const itemListLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: titulo,
    numberOfItems: data.items.length,
    itemListElement: data.items.slice(0, 50).map((it, i) => ({
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListLd) }}
      />
      <CatalogoView data={data} />
    </>
  )
}
