import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const schema = z.object({
  codigo: z.string().min(3).max(32),
  subtotal: z.number().positive(),
})

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  if (!slug || !/^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/.test(slug)) {
    return NextResponse.json({ ok: false, error: "Slug inválido" }, { status: 400 })
  }

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Datos inválidos" }, { status: 400 })
  }

  const { data: config } = await supabaseAdmin
    .from("catalogo_config")
    .select("organization_id, activo")
    .eq("slug", slug)
    .maybeSingle()

  if (!config || !config.activo) {
    return NextResponse.json({ ok: false, error: "Catálogo no disponible" }, { status: 404 })
  }

  const { data: result, error } = await supabaseAdmin.rpc("validar_cupon_catalogo", {
    p_organization_id: config.organization_id,
    p_codigo: parsed.data.codigo.toUpperCase(),
    p_subtotal: parsed.data.subtotal,
  })

  if (error) {
    console.error("Error validando cupón:", error)
    return NextResponse.json({ ok: false, error: "Error al validar" }, { status: 500 })
  }

  return NextResponse.json(result ?? { ok: false, error: "Cupón no encontrado" })
}
