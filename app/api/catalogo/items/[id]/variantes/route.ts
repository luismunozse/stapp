import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidateCatalogo } from "@/lib/catalogo/revalidate"
import { z } from "zod"

const varianteSchema = z.object({
  etiqueta: z.string().min(1).max(80),
  sku: z.string().max(64).nullable().optional(),
  precio: z.number().min(0).nullable().optional(),
  stock: z.number().int().min(0).nullable().optional(),
  imagen_url: z.string().url().nullable().optional(),
  activo: z.boolean().optional(),
  orden: z.number().int().min(0).optional(),
})

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const { id } = await params

  const { data, error } = await supabaseAdmin
    .from("catalogo_variantes")
    .select("*")
    .eq("item_id", id)
    .eq("organization_id", auth.organizationId!)
    .order("orden", { ascending: true })
    .order("created_at", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ variantes: data ?? [] })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const { id } = await params

  // Validar que el item pertenece al tenant
  const { data: item } = await supabaseAdmin
    .from("catalogo_items")
    .select("id")
    .eq("id", id)
    .eq("organization_id", auth.organizationId!)
    .maybeSingle()
  if (!item) return NextResponse.json({ error: "Item no encontrado" }, { status: 404 })

  const body = await req.json()
  const parsed = varianteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 })
  }

  const d = parsed.data

  const { data: maxOrden } = await supabaseAdmin
    .from("catalogo_variantes")
    .select("orden")
    .eq("item_id", id)
    .order("orden", { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextOrden = d.orden ?? ((maxOrden?.orden ?? -1) + 1)

  const { data: variante, error } = await supabaseAdmin
    .from("catalogo_variantes")
    .insert({
      organization_id: auth.organizationId!,
      item_id: id,
      etiqueta: d.etiqueta,
      sku: d.sku ?? null,
      precio: d.precio ?? null,
      stock: d.stock ?? null,
      imagen_url: d.imagen_url ?? null,
      activo: d.activo ?? true,
      orden: nextOrden,
    })
    .select("*")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await revalidateCatalogo(auth.organizationId!, { itemId: id })
  return NextResponse.json({ variante }, { status: 201 })
}
