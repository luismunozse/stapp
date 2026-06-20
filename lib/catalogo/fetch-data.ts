/**
 * Fetcher SSR compartido del catálogo público.
 * Reemplaza ~150 LOC duplicadas entre app/catalogo/[slug]/page.tsx y
 * app/catalogo/[slug]/c/[categoriaSlug]/page.tsx (lógica idéntica de config
 * + org + categorías + items + views + top-variantes).
 *
 * Las pages siguen siendo responsables del unstable_cache wrapper para mantener
 * key/tags propias (slug + categoria) y poder invalidar granularmente.
 */

import { supabaseAdmin } from "@/lib/supabase"
import { SLUG_REGEX } from "@/lib/catalogo-validators"
import type {
  CatalogoPublicData,
  CatalogoPublicItem,
  CatalogoPublicVariante,
} from "./types"

export async function fetchCatalogoBaseData(slug: string): Promise<CatalogoPublicData | null> {
  if (!SLUG_REGEX.test(slug)) return null

  const { data: config } = await supabaseAdmin
    .from("catalogo_config")
    .select("slug, titulo, descripcion, color_primary, whatsapp, banner_url, trust_badges, activo, organization_id")
    .eq("slug", slug)
    .maybeSingle()

  if (!config || !config.activo) return null

  // Queries independientes paralelas (4 RTT → 1).
  const ago7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const [
    { data: org },
    { data: categorias },
    { data: itemsRaw },
    { data: viewsRaw },
  ] = await Promise.all([
    supabaseAdmin
      .from("organizations")
      .select("id, nombre, nombre_mostrar, logo_url, telefono, moneda")
      .eq("id", config.organization_id)
      .single(),
    supabaseAdmin
      .from("catalogo_categorias")
      .select("id, nombre, slug, descripcion, imagen_url, orden")
      .eq("organization_id", config.organization_id)
      .eq("activo", true)
      .order("orden", { ascending: true }),
    supabaseAdmin
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
      .order("orden", { ascending: true }),
    supabaseAdmin
      .from("catalogo_views")
      .select("item_id, visitor_hash")
      .eq("organization_id", config.organization_id)
      .not("item_id", "is", null)
      .gte("created_at", ago7)
      .limit(10000),
  ])

  // El limit() puede truncar en silencio para orgs con mucho tráfico → vistas
  // sesgadas hacia abajo. Lo dejamos visible en logs para detectar el techo.
  if ((viewsRaw?.length ?? 0) >= 10000) {
    console.warn(`[catalogo] views truncadas en 10000 para org ${config.organization_id}; vistas_semana puede estar subestimado`)
  }

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

  // Top variante por item (≥2 ventas para evitar ruido).
  const itemIdsConVariantes = (itemsRaw ?? [])
    .filter((it: any) => (it.variantes ?? []).some((v: any) => v.activo))
    .map((it: any) => it.id as string)
  const topVariantePorItem = new Map<string, string>()
  if (itemIdsConVariantes.length > 0) {
    const { data: vRows } = await supabaseAdmin
      .from("items_cotizacion")
      .select("catalogo_item_id, variante_id")
      .in("catalogo_item_id", itemIdsConVariantes)
      .not("variante_id", "is", null)
      .limit(20000)
    if ((vRows?.length ?? 0) >= 20000) {
      console.warn(`[catalogo] items_cotizacion truncado en 20000 para org ${config.organization_id}; top_variante_id puede estar sesgado`)
    }
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
        if (c > topCount) {
          topCount = c
          topId = vid
        }
      }
      if (topId && topCount >= 2) topVariantePorItem.set(itemId, topId)
    }
  }

  const items: CatalogoPublicItem[] = (itemsRaw ?? []).map((it: any) => {
    const variantesActivas: any[] = (it.variantes ?? [])
      .filter((v: any) => v.activo)
      .sort((a: any, b: any) => a.orden - b.orden)
    const tieneVariantes = variantesActivas.length > 0
    const stockVariantes = tieneVariantes
      ? variantesActivas.reduce((s: number | null, v: any) => {
          if (v.stock == null) return null
          return s == null ? null : s + v.stock
        }, 0)
      : null
    const stockReal: number | null = tieneVariantes
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
    const variantes: CatalogoPublicVariante[] = variantesActivas.map((v) => ({
      id: v.id,
      etiqueta: v.etiqueta,
      sku: v.sku,
      precio: v.precio,
      stock: v.stock,
      imagen_url: v.imagen_url,
    }))
    return {
      id: it.id,
      tipo: it.tipo,
      nombre: it.nombre,
      descripcion: it.descripcion,
      categoria_id: it.categoria_id,
      precio: precioMin,
      precio_hasta: it.precio_hasta,
      precio_lista: it.precio_lista,
      imagen_url: it.imagen_url,
      imagenes: it.imagenes ?? [],
      etiquetas: it.etiquetas ?? [],
      stock_disponible: stockReal,
      destacado: it.destacado,
      // Visitantes únicos (dedup por visitor_hash). Fallback a total solo si no
      // hay hashes registrados, para no romper el conteo en datos legacy.
      vistas_semana: vistasUnicas || vistasTotal,
      top_variante_id: topVarId,
      variantes,
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
    categorias: (categorias ?? []) as any,
    items,
  }
}
