import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

type SerieDia = { fecha: string; vistas: number }
type ItemTop = { id: string; nombre: string; vistas: number }
type StatsResponse = {
  vistas_total: number
  vistas_7d: number
  vistas_30d: number
  visitantes_unicos_30d: number
  cotizaciones_total: number
  cotizaciones_30d: number
  serie_30d: SerieDia[]
  items_top: ItemTop[]
}

export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const orgId = auth.organizationId!
  const now = new Date()
  const ago7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const ago30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const ago30ISO = ago30.toISOString()
  const ago7ISO = ago7.toISOString()

  // Vistas: traemos solo últimos 30 días (lo suficiente para serie + agregados)
  const { data: views30 } = await supabaseAdmin
    .from("catalogo_views")
    .select("created_at, visitor_hash, item_id")
    .eq("organization_id", orgId)
    .gte("created_at", ago30ISO)
    .order("created_at", { ascending: false })
    .limit(50000)

  // Conteo total histórico (puede ser caro a futuro; OK por ahora)
  const { count: vistasTotal } = await supabaseAdmin
    .from("catalogo_views")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)

  const v30 = views30 ?? []
  const vistas30d = v30.length
  const vistas7d = v30.filter((v) => v.created_at >= ago7ISO).length

  const visitantesSet = new Set<string>()
  for (const v of v30) if (v.visitor_hash) visitantesSet.add(v.visitor_hash)
  const visitantesUnicos30d = visitantesSet.size

  // Serie por día (30 días, incluso días sin vistas)
  const serieMap = new Map<string, number>()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
    const key = d.toISOString().slice(0, 10)
    serieMap.set(key, 0)
  }
  for (const v of v30) {
    const key = v.created_at.slice(0, 10)
    if (serieMap.has(key)) serieMap.set(key, (serieMap.get(key) ?? 0) + 1)
  }
  const serie30d: SerieDia[] = Array.from(serieMap.entries()).map(([fecha, vistas]) => ({ fecha, vistas }))

  // Top items últimos 30d
  const itemCount = new Map<string, number>()
  for (const v of v30) {
    if (!v.item_id) continue
    itemCount.set(v.item_id, (itemCount.get(v.item_id) ?? 0) + 1)
  }
  const topIds = Array.from(itemCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id)

  let itemsTop: ItemTop[] = []
  if (topIds.length > 0) {
    const { data: itemsData } = await supabaseAdmin
      .from("catalogo_items")
      .select("id, nombre")
      .in("id", topIds)
      .eq("organization_id", orgId)
    const nameMap = new Map((itemsData ?? []).map((i: any) => [i.id, i.nombre]))
    itemsTop = topIds.map((id) => ({
      id,
      nombre: nameMap.get(id) ?? "(eliminado)",
      vistas: itemCount.get(id) ?? 0,
    }))
  }

  // Cotizaciones desde catálogo
  const { count: cotTotal } = await supabaseAdmin
    .from("cotizaciones")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("origen", "CATALOGO_PUBLICO")

  const { count: cot30 } = await supabaseAdmin
    .from("cotizaciones")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("origen", "CATALOGO_PUBLICO")
    .gte("created_at", ago30ISO)

  const response: StatsResponse = {
    vistas_total: vistasTotal ?? 0,
    vistas_7d: vistas7d,
    vistas_30d: vistas30d,
    visitantes_unicos_30d: visitantesUnicos30d,
    cotizaciones_total: cotTotal ?? 0,
    cotizaciones_30d: cot30 ?? 0,
    serie_30d: serie30d,
    items_top: itemsTop,
  }

  return NextResponse.json(response)
}
