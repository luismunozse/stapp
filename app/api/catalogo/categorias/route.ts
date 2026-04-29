import { NextResponse } from "next/server"
import { requireAuth, requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const categoriaSchema = z.object({
  nombre: z.string().min(1).max(80),
  descripcion: z.string().max(500).nullable().optional(),
  imagen_url: z.string().url().nullable().optional(),
  orden: z.number().int().min(0).optional(),
  activo: z.boolean().optional(),
})

export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  const { data, error } = await supabaseAdmin
    .from("catalogo_categorias")
    .select("*")
    .eq("organization_id", auth.organizationId!)
    .order("orden", { ascending: true })
    .order("created_at", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ categorias: data ?? [] })
}

export async function POST(req: Request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const body = await req.json()
  const parsed = categoriaSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 })
  }

  const { data: maxOrden } = await supabaseAdmin
    .from("catalogo_categorias")
    .select("orden")
    .eq("organization_id", auth.organizationId!)
    .order("orden", { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextOrden = parsed.data.orden ?? ((maxOrden?.orden ?? -1) + 1)

  const { data, error } = await supabaseAdmin
    .from("catalogo_categorias")
    .insert({
      organization_id: auth.organizationId!,
      nombre: parsed.data.nombre,
      descripcion: parsed.data.descripcion ?? null,
      imagen_url: parsed.data.imagen_url ?? null,
      orden: nextOrden,
      activo: parsed.data.activo ?? true,
    })
    .select("*")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ categoria: data }, { status: 201 })
}
