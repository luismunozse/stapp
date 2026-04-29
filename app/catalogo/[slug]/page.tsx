import { notFound } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { CatalogoView } from "@/components/catalogo-public/catalogo-view"
import type { Metadata, Viewport } from "next"

type PageProps = { params: Promise<{ slug: string }> }

async function fetchCatalogo(slug: string) {
  if (!/^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/.test(slug)) return null

  const { data: config } = await supabaseAdmin
    .from("catalogo_config")
    .select("slug, titulo, descripcion, color_primary, whatsapp, activo, organization_id")
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
      id, tipo, nombre, descripcion, categoria_id, precio, precio_hasta,
      imagen_url, imagenes, etiquetas, stock, inventario_id, orden,
      inventario:inventario(stock)
    `)
    .eq("organization_id", config.organization_id)
    .eq("activo", true)
    .order("orden", { ascending: true })

  const items = (itemsRaw ?? []).map((it: any) => {
    const stockReal =
      it.inventario_id && it.inventario ? it.inventario.stock : it.stock
    const { inventario, ...rest } = it
    return { ...rest, stock_disponible: stockReal }
  })

  return {
    config: {
      slug: config.slug,
      titulo: config.titulo,
      descripcion: config.descripcion,
      color_primary: config.color_primary || "#2563eb",
      whatsapp: config.whatsapp,
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

  return <CatalogoView data={data} />
}
