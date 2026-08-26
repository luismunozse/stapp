import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { stockDisponibleCatalogo } from "@/lib/catalogo/stock-disponible"

// Devuelve top 3 items "comprados juntos" calculados a partir de cotizaciones
// del catálogo público que incluyeron el item solicitado.
// Si no hay historial suficiente, devuelve { items: [] } y el front cae al
// cross-sell por categoría que ya tiene.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params

  if (!slug || !/^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/.test(slug)) {
    return NextResponse.json({ items: [] })
  }

  const { data: config } = await supabaseAdmin
    .from("catalogo_config")
    .select("organization_id, activo")
    .eq("slug", slug)
    .maybeSingle()

  if (!config || !config.activo) {
    return NextResponse.json({ items: [] })
  }

  // 1. Cotizaciones que incluyeron este item
  const { data: rowsBase } = await supabaseAdmin
    .from("items_cotizacion")
    .select("cotizacion_id")
    .eq("catalogo_item_id", id)
    .limit(500)

  const cotIds = Array.from(new Set((rowsBase ?? []).map((r) => r.cotizacion_id))).filter(Boolean)
  if (cotIds.length === 0) {
    return NextResponse.json({ items: [] })
  }

  // 2. Resto de items en esas cotizaciones
  const { data: rowsOtros } = await supabaseAdmin
    .from("items_cotizacion")
    .select("catalogo_item_id")
    .in("cotizacion_id", cotIds)
    .not("catalogo_item_id", "is", null)
    .neq("catalogo_item_id", id)
    .limit(5000)

  const counts = new Map<string, number>()
  for (const r of rowsOtros ?? []) {
    if (!r.catalogo_item_id) continue
    counts.set(r.catalogo_item_id, (counts.get(r.catalogo_item_id) ?? 0) + 1)
  }

  // 3. Top 3 ids ordenados por co-ocurrencia
  const topIds = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k)

  if (topIds.length === 0) {
    return NextResponse.json({ items: [] })
  }

  // 4. Cargar items activos (filtrar por org del catálogo y stock != 0)
  const { data: items } = await supabaseAdmin
    .from("catalogo_items")
    .select(`
      id, tipo, nombre, precio, precio_lista, imagen_url,
      stock, inventario_id, activo, organization_id,
      inventario:inventario(stock, stock_reservado)
    `)
    .in("id", topIds)
    .eq("organization_id", config.organization_id)
    .eq("activo", true)

  const result = (items ?? [])
    .map((it: any) => {
      const stockReal = stockDisponibleCatalogo(it)
      const { inventario, organization_id, activo, ...rest } = it
      return {
        ...rest,
        stock_disponible: stockReal,
        co_count: counts.get(it.id) ?? 0,
      }
    })
    .filter((i: any) => i.stock_disponible !== 0)
    .sort((a: any, b: any) => b.co_count - a.co_count)

  return NextResponse.json({ items: result })
}
