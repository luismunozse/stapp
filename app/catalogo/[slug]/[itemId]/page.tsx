import { notFound } from "next/navigation"
import Link from "next/link"
import { unstable_cache } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase"
import { CatalogoItemView } from "@/components/catalogo-public/catalogo-item-view"
import type { Metadata, Viewport } from "next"

type PageProps = { params: Promise<{ slug: string; itemId: string }> }

const fetchItem = unstable_cache(
  _fetchItem,
  ["catalogo-item"],
  { revalidate: 60, tags: ["catalogo"] }
)

async function _fetchItem(slug: string, itemId: string) {
  if (!/^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/.test(slug)) return null

  const { data: config } = await supabaseAdmin
    .from("catalogo_config")
    .select("slug, titulo, descripcion, color_primary, whatsapp, banner_url, activo, organization_id")
    .eq("slug", slug)
    .maybeSingle()

  if (!config || !config.activo) return null

  const { data: itemRaw } = await supabaseAdmin
    .from("catalogo_items")
    .select(`
      id, tipo, nombre, descripcion, categoria_id, precio, precio_hasta, precio_lista,
      imagen_url, imagenes, etiquetas, stock, destacado, inventario_id,
      inventario:inventario(stock),
      variantes:catalogo_variantes(id, etiqueta, sku, precio, stock, imagen_url, activo, orden)
    `)
    .eq("id", itemId)
    .eq("organization_id", config.organization_id)
    .eq("activo", true)
    .maybeSingle()

  if (!itemRaw) return null

  const variantesActivas = ((itemRaw as any).variantes ?? [])
    .filter((v: any) => v.activo)
    .sort((a: any, b: any) => a.orden - b.orden)
  const tieneVariantes = variantesActivas.length > 0

  // Top variante (más elegida en cotizaciones histórico)
  let topVarianteId: string | null = null
  if (tieneVariantes) {
    const { data: vRows } = await supabaseAdmin
      .from("items_cotizacion")
      .select("variante_id")
      .eq("catalogo_item_id", itemId)
      .not("variante_id", "is", null)
      .limit(5000)
    const counts = new Map<string, number>()
    for (const r of vRows ?? []) {
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
    : itemRaw.inventario_id && (itemRaw as any).inventario
      ? (itemRaw as any).inventario.stock
      : itemRaw.stock
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

  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("id, nombre, nombre_mostrar, logo_url, telefono, moneda")
    .eq("id", config.organization_id)
    .single()

  // Items relacionados misma categoría
  let relacionados: any[] = []
  if (item.categoria_id) {
    const { data } = await supabaseAdmin
      .from("catalogo_items")
      .select(`
        id, tipo, nombre, descripcion, categoria_id, precio, precio_hasta, precio_lista,
        imagen_url, imagenes, etiquetas, stock, destacado, inventario_id,
        inventario:inventario(stock)
      `)
      .eq("organization_id", config.organization_id)
      .eq("activo", true)
      .eq("categoria_id", item.categoria_id)
      .neq("id", itemId)
      .order("destacado", { ascending: false })
      .order("precio", { ascending: false, nullsFirst: false })
      .limit(8)
    relacionados = (data ?? []).map((it: any) => {
      const stk = it.inventario_id && it.inventario ? it.inventario.stock : it.stock
      const { inventario: _i, ...rs } = it
      return { ...rs, stock_disponible: stk }
    })
  }

  // Bundle "comprados juntos" — top 3 ids co-ocurrentes en cotizaciones
  let bundle: any[] = []
  const { data: rowsBase } = await supabaseAdmin
    .from("items_cotizacion")
    .select("cotizacion_id")
    .eq("catalogo_item_id", itemId)
    .limit(500)
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
          inventario:inventario(stock)
        `)
        .in("id", topIds)
        .eq("organization_id", config.organization_id)
        .eq("activo", true)
      bundle = (bItems ?? [])
        .map((it: any) => {
          const stk = it.inventario_id && it.inventario ? it.inventario.stock : it.stock
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
  const titulo = `${data.item.nombre} — ${orgName}`
  const desc = data.item.descripcion?.slice(0, 200) || `${data.item.nombre} disponible en el catálogo de ${orgName}`

  return {
    title: titulo,
    description: desc,
    openGraph: {
      title: data.item.nombre,
      description: desc,
      images: data.item.imagen_url ? [data.item.imagen_url] : [],
      type: "website",
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

  const productLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": data.item.tipo === "SERVICIO" ? "Service" : "Product",
    name: data.item.nombre,
    description: data.item.descripcion || undefined,
    image: data.item.imagen_url ? [data.item.imagen_url, ...data.item.imagenes] : undefined,
    brand: { "@type": "Organization", name: orgName },
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

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productLd) }}
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
