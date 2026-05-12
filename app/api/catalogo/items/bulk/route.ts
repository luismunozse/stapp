import { NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const bulkSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("activar"),
    ids: z.array(z.string().uuid()).min(1).max(500),
  }),
  z.object({
    action: z.literal("desactivar"),
    ids: z.array(z.string().uuid()).min(1).max(500),
  }),
  z.object({
    action: z.literal("destacar"),
    ids: z.array(z.string().uuid()).min(1).max(500),
    valor: z.boolean(),
  }),
  z.object({
    action: z.literal("borrar"),
    ids: z.array(z.string().uuid()).min(1).max(500),
  }),
  z.object({
    action: z.literal("cambiar_categoria"),
    ids: z.array(z.string().uuid()).min(1).max(500),
    categoria_id: z.string().uuid().nullable(),
  }),
])

export async function POST(req: Request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const body = await req.json()
  const parsed = bulkSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 })
  }

  const orgId = auth.organizationId!
  const d = parsed.data

  // Validar categoría pertenece al tenant
  if (d.action === "cambiar_categoria" && d.categoria_id) {
    const { data: cat } = await supabaseAdmin
      .from("catalogo_categorias")
      .select("id")
      .eq("id", d.categoria_id)
      .eq("organization_id", orgId)
      .maybeSingle()
    if (!cat) return NextResponse.json({ error: "Categoría no encontrada" }, { status: 400 })
  }

  if (d.action === "borrar") {
    const { error, count } = await supabaseAdmin
      .from("catalogo_items")
      .delete({ count: "exact" })
      .in("id", d.ids)
      .eq("organization_id", orgId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    revalidateTag("catalogo", "max")
    return NextResponse.json({ ok: true, affected: count ?? 0 })
  }

  let patch: Record<string, unknown>
  if (d.action === "activar") patch = { activo: true }
  else if (d.action === "desactivar") patch = { activo: false }
  else if (d.action === "destacar") patch = { destacado: d.valor }
  else patch = { categoria_id: d.categoria_id }

  const { error, count } = await supabaseAdmin
    .from("catalogo_items")
    .update(patch, { count: "exact" })
    .in("id", d.ids)
    .eq("organization_id", orgId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidateTag("catalogo", "max")
  return NextResponse.json({ ok: true, affected: count ?? 0 })
}
