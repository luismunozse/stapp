import { notFound } from "next/navigation"
import Link from "next/link"
import { unstable_cache } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase"
import { CatalogoItemView } from "@/components/catalogo-public/catalogo-item-view"
import { stockDisponibleCatalogo } from "@/lib/catalogo/stock-disponible"
import { buildItemDescription, buildItemTitle } from "@/lib/catalogo/item-meta"
import type { Metadata, Viewport } from "next"

type PageProps = { params: Promise<{ slug: string; itemId: string }> }

// Key con slug + itemId: cada item tiene su propia entry. Tags incluyen
// `catalogo:${slug}` para que la invalidación del catálogo arrastre también
// sus items.
function fetchItem(slug: string, itemId: string) {
  return unstable_cache(
    () => _fetchItem(slug, itemId),
    ["catalogo-item", slug, itemId],
    { revalidate: 60, tags: ["catalogo", `catalogo:${slug}`, `catalogo-item:${itemId}`] }
  )()
}

async function _fetchItem(slug: string, itemId: string) {
  if (!/^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/.test(slug)) return null

  const { data: config } = await supabaseAdmin
    .from("catalogo_config")
    .select("slug, titulo, descripcion, color_primary, whatsapp, banner_url, activo, organization_id")
    .eq("slug", slug)
    .maybeSingle()

  if (!config || !config.activo) return null

  // Item + org + top-variante + bundle-base en paralelo (4 RTT → 1).
  // No dependen entre sí (todas usan itemId/organization_id ya conocidos).
  const [
    { data: itemRaw },
    { data: org },
    { data: vRows },
    { data: rowsBase },
  ] = await Promise.all([
    supabaseAdmin
      .from("catalogo_items")
      .select(`
        id, tipo, nombre, descripcion, categoria_id, precio, precio_hasta, precio_lista,
        imagen_url, imagenes, etiquetas, stock, destacado, inventario_id,
        inventario:inventario(stock, stock_reservado, deleted_at),
        variantes:catalogo_variantes(id, etiqueta, sku, precio, stock, imagen_url, activo, orden)
      `)
      .eq("id", itemId)
      .eq("organization_id", config.organization_id)
      .eq("activo", true)
      .maybeSingle(),
    supabaseAdmin
      .from("organizations")
      .select("id, nombre, nombre_mostrar, logo_url, telefono, moneda")
      .eq("id", config.organization_id)
      .single(),
    supabaseAdmin
      .from("items_cotizacion")
      .select("variante_id")
      .eq("catalogo_item_id", itemId)
      .not("variante_id", "is", null)
      .limit(5000),
    supabaseAdmin
      .from("items_cotizacion")
      .select("cotizacion_id")
      .eq("catalogo_item_id", itemId)
      .limit(500),
  ])

  if (!itemRaw) return null

  const variantesActivas = ((itemRaw as any).variantes ?? [])
    .filter((v: any) => v.activo)
    .sort((a: any, b: any) => a.orden - b.orden)
  const tieneVariantes = variantesActivas.length > 0

  let topVarianteId: string | null = null
  if (tieneVariantes && vRows) {
    const counts = new Map<string, number>()
    for (const r of vRows) {
      if (!r.variante_id) continue
      counts.set(r.variante_id, (counts.get(r.variante_id) ?? 0) + 1)
    }
    let topCount = 0
    for (const [vid, c] of counts.entries()) {
      if (c > topCount) {
        topCount = c
        topVarianteId = vid
      }
    }
    if (topCount < 2) topVarianteId = null
  }
  const stockVariantes = tieneVariantes
    ? variantesActivas.reduce((s: number | null, v: any) => {
        if (v.stock == null) return null
        return s == null ? null : s + v.stock
      }, 0)
    : null
  const stockReal = tieneVariantes
    ? stockVariantes
    : stockDisponibleCatalogo(itemRaw as any)
  const precioMin = tieneVariantes
    ? variantesActivas.reduce((m: number | null, v: any) => {
        if (v.precio == null) return m
        return m == null ? Number(v.precio) : Math.min(m, Number(v.precio))
      }, null) ?? itemRaw.precio
    : itemRaw.precio
  const { inventario, variantes, ...rest } = itemRaw as any
  const item = {
    ...rest,
    precio: precioMin,
    stock_disponible: stockReal,
    top_variante_id: topVarianteId,
    variantes: variantesActivas.map((v: any) => ({
      id: v.id,
      etiqueta: v.etiqueta,
      sku: v.sku,
      precio: v.precio,
      stock: v.stock,
      imagen_url: v.imagen_url,
    })),
  }

  // Items relacionados misma categoría
  let relacionados: any[] = []
  if (item.categoria_id) {
    const { data } = await supabaseAdmin
      .from("catalogo_items")
      .select(`
        id, tipo, nombre, descripcion, categoria_id, precio, precio_hasta, precio_lista,
        imagen_url, imagenes, etiquetas, stock, destacado, inventario_id,
        inventario:inventario(stock, stock_reservado, deleted_at)
      `)
      .eq("organization_id", config.organization_id)
      .eq("activo", true)
      .eq("categoria_id", item.categoria_id)
      .neq("id", itemId)
      .order("destacado", { ascending: false })
      .order("precio", { ascending: false, nullsFirst: false })
      .limit(8)
    relacionados = (data ?? []).map((it: any) => {
      const stk = stockDisponibleCatalogo(it)
      const { inventario: _i, ...rs } = it
      return { ...rs, stock_disponible: stk }
    })
  }

  // Bundle "comprados juntos" — top 3 ids co-ocurrentes en cotizaciones
  // rowsBase ya cargado en el Promise.all inicial.
  let bundle: any[] = []
  const cotIds = Array.from(new Set((rowsBase ?? []).map((r) => r.cotizacion_id))).filter(Boolean)
  if (cotIds.length > 0) {
    const { data: rowsOtros } = await supabaseAdmin
      .from("items_cotizacion")
      .select("catalogo_item_id")
      .in("cotizacion_id", cotIds)
      .not("catalogo_item_id", "is", null)
      .neq("catalogo_item_id", itemId)
      .limit(5000)
    const counts = new Map<string, number>()
    for (const r of rowsOtros ?? []) {
      if (!r.catalogo_item_id) continue
      counts.set(r.catalogo_item_id, (counts.get(r.catalogo_item_id) ?? 0) + 1)
    }
    const topIds = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k)
    if (topIds.length > 0) {
      const { data: bItems } = await supabaseAdmin
        .from("catalogo_items")
        .select(`
          id, tipo, nombre, descripcion, categoria_id, precio, precio_hasta, precio_lista,
          imagen_url, imagenes, etiquetas, stock, destacado, inventario_id,
          inventario:inventario(stock, stock_reservado, deleted_at)
        `)
        .in("id", topIds)
        .eq("organization_id", config.organization_id)
        .eq("activo", true)
      bundle = (bItems ?? [])
        .map((it: any) => {
          const stk = stockDisponibleCatalogo(it)
          const { inventario: _i, ...rs } = it
          return { ...rs, stock_disponible: stk, co_count: counts.get(it.id) ?? 0 }
        })
        .filter((i: any) => i.stock_disponible !== 0)
        .sort((a: any, b: any) => b.co_count - a.co_count)
    }
  }

  return {
    config: {
      slug: config.slug,
      titulo: config.titulo,
      color_primary: config.color_primary || "#2563eb",
      whatsapp: config.whatsapp,
    },
    organizacion: org!,
    item,
    relacionados,
    bundle,
  }
}

export async function generateViewport({ params }: PageProps): Promise<Viewport> {
  const { slug, itemId } = await params
  const data = await fetchItem(slug, itemId)
  return { themeColor: data?.config.color_primary || "#2563eb" }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, itemId } = await params
  const data = await fetchItem(slug, itemId)
  if (!data) return { title: "Item no encontrado" }

  const orgName = data.organizacion.nombre_mostrar || data.organizacion.nombre
  const titulo = buildItemTitle(data.item.nombre, orgName)
  const desc = buildItemDescription({
    nombre: data.item.nombre,
    descripcion: data.item.descripcion,
    etiquetas: data.item.etiquetas,
    precio: data.item.precio,
    precioHasta: data.item.precio_hasta,
    moneda: data.organizacion.moneda,
    stockDisponible: data.item.stock_disponible,
    orgName,
  })

  return {
    title: titulo,
    description: desc,
    alternates: {
      canonical: `/catalogo/${slug}/${itemId}`,
    },
    openGraph: {
      title: data.item.nombre,
      description: desc,
      // Si hay imagen propia del item se prefiere; sino dejamos que el
      // opengraph-image.tsx generado domine. Width/height ayudan a previews.
      ...(data.item.imagen_url && {
        images: [{ url: data.item.imagen_url, width: 1200, height: 630 }],
      }),
      type: "website",
      url: `/catalogo/${slug}/${itemId}`,
    },
  }
}

export default async function ItemPermalinkPage({ params }: PageProps) {
  const { slug, itemId } = await params
  const data = await fetchItem(slug, itemId)
  if (!data) notFound()

  // Schema.org Product JSON-LD
  const orgName = data.organizacion.nombre_mostrar || data.organizacion.nombre
  const moneda = data.organizacion.moneda || "ARS"
  const availability =
    data.item.stock_disponible === 0
      ? "https://schema.org/OutOfStock"
      : "https://schema.org/InStock"

  // URL absoluta + priceValidUntil (rich snippets de Google los exigen).
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || ""
  const abs = (p: string) => (baseUrl ? `${baseUrl}${p}` : p)
  const priceValidUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
  const itemAbsUrl = abs(`/catalogo/${slug}/${itemId}`)

  const productLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": data.item.tipo === "SERVICIO" ? "Service" : "Product",
    name: data.item.nombre,
    sku: data.item.id,
    description: data.item.descripcion || undefined,
    image: data.item.imagen_url ? [data.item.imagen_url, ...data.item.imagenes] : undefined,
    brand: { "@type": "Organization", name: orgName },
    url: itemAbsUrl,
  }
  if (data.item.precio != null) {
    const hasAnchor =
      data.item.precio_lista != null &&
      Number(data.item.precio_lista) > Number(data.item.precio)
    productLd.offers = {
      "@type": "Offer",
      price: Number(data.item.precio),
      priceCurrency: moneda,
      availability,
      priceValidUntil,
      url: itemAbsUrl,
      seller: { "@type": "Organization", name: orgName },
      ...(hasAnchor && {
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          priceType: "https://schema.org/ListPrice",
          price: Number(data.item.precio_lista),
          priceCurrency: moneda,
        },
      }),
    }
  }

  // BreadcrumbList: catálogo → (categoría?) → item. Habilita breadcrumbs
  // visibles en SERPs.
  const breadcrumbItems: Array<{ name: string; href: string }> = [
    { name: orgName, href: `/catalogo/${slug}` },
  ]
  // No tenemos info de slug categoría acá; si existe categoria_id, mostramos
  // un nivel genérico. Para link real haría falta extender fetchItem.
  breadcrumbItems.push({ name: data.item.nombre, href: `/catalogo/${slug}/${itemId}` })
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbItems.map((b, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: b.name,
      item: abs(b.href),
    })),
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <CatalogoItemView data={data} />
      <div className="container mx-auto max-w-5xl px-4 pb-8 text-center">
        <Link href={`/catalogo/${slug}`} className="text-sm underline text-muted-foreground hover:text-foreground">
          ← Ver catálogo completo
        </Link>
      </div>
    </>
  )
}
