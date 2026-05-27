import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidateCatalogo } from "@/lib/catalogo/revalidate"
import { z } from "zod"

const updateSchema = z.object({
  etiqueta: z.string().min(1).max(80).optional(),
  sku: z.string().max(64).nullable().optional(),
  precio: z.number().min(0).nullable().optional(),
  stock: z.number().int().min(0).nullable().optional(),
  imagen_url: z.string().url().nullable().optional(),
  activo: z.boolean().optional(),
  orden: z.number().int().min(0).optional(),
})

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; varId: string }> }
) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const { id, varId } = await params

  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from("catalogo_variantes")
    .update(parsed.data)
    .eq("id", varId)
    .eq("item_id", id)
    .eq("organization_id", auth.organizationId!)
    .select("*")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: "Variante no encontrada" }, { status: 404 })
  await revalidateCatalogo(auth.organizationId!, { itemId: id })
  return NextResponse.json({ variante: data })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; varId: string }> }
) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const { id, varId } = await params

  const { error } = await supabaseAdmin
    .from("catalogo_variantes")
    .delete()
    .eq("id", varId)
    .eq("item_id", id)
    .eq("organization_id", auth.organizationId!)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await revalidateCatalogo(auth.organizationId!, { itemId: id })
  return NextResponse.json({ ok: true })
}
