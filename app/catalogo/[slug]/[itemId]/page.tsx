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
      id, tipo, nombre, descripcion, categoria_id, precio, precio_hasta,
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
        id, tipo, nombre, descripcion, categoria_id, precio, precio_hasta,
        imagen_url, imagenes, etiquetas, stock, destacado, inventario_id,
        inventario:inventario(stock)
      `)
      .eq("organization_id", config.organization_id)
      .eq("activo", true)
      .eq("categoria_id", item.categoria_id)
      .neq("id", itemId)
      .order("destacado", { ascending: false })
      .limit(8)
    relacionados = (data ?? []).map((it: any) => {
      const stk = it.inventario_id && it.inventario ? it.inventario.stock : it.stock
      const { inventario: _i, ...rs } = it
      return { ...rs, stock_disponible: stk }
    })
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
    productLd.offers = {
      "@type": "Offer",
      price: Number(data.item.precio),
      priceCurrency: moneda,
      availability,
      seller: { "@type": "Organization", name: orgName },
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
