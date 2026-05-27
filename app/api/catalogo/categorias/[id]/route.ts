import { NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"
import { CATEGORIA_SLUG_REGEX, generarSlugCategoriaUnico } from "@/lib/catalogo-slug"

const updateSchema = z.object({
  nombre: z.string().min(1).max(80).optional(),
  slug: z.string().regex(CATEGORIA_SLUG_REGEX, "Slug inválido").optional(),
  descripcion: z.string().max(500).nullable().optional(),
  imagen_url: z.string().url().nullable().optional(),
  orden: z.number().int().min(0).optional(),
  activo: z.boolean().optional(),
})

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const { id } = await params

  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 })
  }

  const updates: Record<string, unknown> = { ...parsed.data }
  if (parsed.data.slug !== undefined) {
    updates.slug = await generarSlugCategoriaUnico(
      auth.organizationId!,
      parsed.data.slug || parsed.data.nombre || "categoria",
      id
    )
  }

  const { data, error } = await supabaseAdmin
    .from("catalogo_categorias")
    .update(updates)
    .eq("id", id)
    .eq("organization_id", auth.organizationId!)
    .select("*")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: "Categoría no encontrada" }, { status: 404 })
  revalidateTag("catalogo", "max")
  return NextResponse.json({ categoria: data })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const { id } = await params

  const { error } = await supabaseAdmin
    .from("catalogo_categorias")
    .delete()
    .eq("id", id)
    .eq("organization_id", auth.organizationId!)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidateTag("catalogo", "max")
  return NextResponse.json({ ok: true })
}
