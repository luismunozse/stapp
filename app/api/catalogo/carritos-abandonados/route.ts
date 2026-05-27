import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(req: Request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const url = new URL(req.url)
  const includeRecovered = url.searchParams.get("include_recovered") === "1"
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50))
  const dias = Math.min(180, Math.max(1, Number(url.searchParams.get("dias")) || 30))
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()

  let query = supabaseAdmin
    .from("catalogo_carritos_abandonados")
    .select("*")
    .eq("organization_id", auth.organizationId!)
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (!includeRecovered) {
    query = query.is("recovered_at", null)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { count: pendientes } = await supabaseAdmin
    .from("catalogo_carritos_abandonados")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", auth.organizationId!)
    .is("recovered_at", null)

  return NextResponse.json({
    carritos: data ?? [],
    pendientes: pendientes ?? 0,
  })
}
