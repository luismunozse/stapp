import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { createHash } from "crypto"
import { z } from "zod"

const abandonoSchema = z.object({
  cliente: z.object({
    nombre: z.string().min(1).max(120),
    telefono: z.string().min(4).max(40),
    email: z.string().email().optional().or(z.literal("")),
  }),
  items: z.array(z.object({
    itemId: z.string(),
    varianteId: z.string().nullable().optional(),
    varianteEtiqueta: z.string().nullable().optional(),
    nombre: z.string().max(200),
    cantidad: z.number().int().positive(),
    precioUnitario: z.number().min(0),
    imagen_url: z.string().url().nullable().optional(),
  })).min(1).max(50),
  total: z.number().min(0),
  cuponCodigo: z.string().max(32).optional(),
  // Consent explícito requerido para snapshot PII (Ley 25.326 / GDPR-like).
  consent: z.literal(true),
})

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  if (!slug || !/^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/.test(slug)) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const parsed = abandonoSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const { data: config } = await supabaseAdmin
    .from("catalogo_config")
    .select("organization_id, activo")
    .eq("slug", slug)
    .maybeSingle()

  if (!config || !config.activo) {
    return NextResponse.json({ ok: true })
  }

  const d = parsed.data
  const telefono = d.cliente.telefono.trim()

  const ua = req.headers.get("user-agent") || ""
  const fwd = req.headers.get("x-forwarded-for") || ""
  const ip = fwd.split(",")[0]?.trim() || req.headers.get("x-real-ip") || ""
  const visitorHash = ip
    ? createHash("sha256").update(`${ip}|${ua}|${slug}`).digest("hex").slice(0, 32)
    : null

  // Upsert por (organization_id, cliente_telefono) where recovered_at IS NULL.
  // No usamos onConflict porque el índice único es parcial; hacemos lookup manual.
  const { data: existing } = await supabaseAdmin
    .from("catalogo_carritos_abandonados")
    .select("id")
    .eq("organization_id", config.organization_id)
    .eq("cliente_telefono", telefono)
    .is("recovered_at", null)
    .maybeSingle()

  const payload = {
    organization_id: config.organization_id,
    catalogo_slug: slug,
    visitor_hash: visitorHash,
    cliente_nombre: d.cliente.nombre.trim(),
    cliente_telefono: telefono,
    cliente_email: d.cliente.email?.trim() || null,
    items: d.items,
    total_estimado: d.total,
    cupon_codigo: d.cuponCodigo?.toUpperCase() || null,
    consent_at: new Date().toISOString(),
  }

  if (existing) {
    await supabaseAdmin
      .from("catalogo_carritos_abandonados")
      .update(payload)
      .eq("id", existing.id)
  } else {
    await supabaseAdmin
      .from("catalogo_carritos_abandonados")
      .insert(payload)
  }

  return NextResponse.json({ ok: true })
}
