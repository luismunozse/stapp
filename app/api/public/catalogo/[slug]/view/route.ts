import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { createHash } from "crypto"
import { z } from "zod"

const viewSchema = z.object({
  itemId: z.string().nullable().optional(),
}).optional()

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  if (!slug || !/^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/.test(slug)) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  // Body opcional. Si falla parse, registramos vista del catálogo (sin item)
  let itemId: string | null = null
  try {
    const body = await req.json().catch(() => ({}))
    const parsed = viewSchema.safeParse(body)
    if (parsed.success && parsed.data?.itemId) itemId = parsed.data.itemId
  } catch { /* ignore */ }

  const { data: config } = await supabaseAdmin
    .from("catalogo_config")
    .select("organization_id, activo")
    .eq("slug", slug)
    .maybeSingle()

  if (!config || !config.activo) {
    // No revelar info; respondemos OK silencioso para no usar como sonda
    return NextResponse.json({ ok: true })
  }

  // Si itemId, validar pertenencia al tenant del catálogo
  if (itemId) {
    const { data: item } = await supabaseAdmin
      .from("catalogo_items")
      .select("id")
      .eq("id", itemId)
      .eq("organization_id", config.organization_id)
      .maybeSingle()
    if (!item) itemId = null
  }

  // Hash de visitante: IP + UA (no PII). Útil para conteo unique aprox.
  const ua = req.headers.get("user-agent") || ""
  const fwd = req.headers.get("x-forwarded-for") || ""
  const ip = fwd.split(",")[0]?.trim() || req.headers.get("x-real-ip") || ""
  const visitorHash = ip
    ? createHash("sha256").update(`${ip}|${ua}|${slug}`).digest("hex").slice(0, 32)
    : null

  const referer = req.headers.get("referer")?.slice(0, 500) || null

  await supabaseAdmin.from("catalogo_views").insert({
    organization_id: config.organization_id,
    catalogo_slug: slug,
    item_id: itemId,
    visitor_hash: visitorHash,
    referer,
    user_agent: ua.slice(0, 500) || null,
  })

  return NextResponse.json({ ok: true })
}
