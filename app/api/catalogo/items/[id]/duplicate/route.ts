import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidateCatalogo } from "@/lib/catalogo/revalidate"

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const { id } = await params
  const orgId = auth.organizationId!

  const { data: original, error: fetchErr } = await supabaseAdmin
    .from("catalogo_items")
    .select("*")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle()

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!original) return NextResponse.json({ error: "Item no encontrado" }, { status: 404 })

  const { data: maxOrden } = await supabaseAdmin
    .from("catalogo_items")
    .select("orden")
    .eq("organization_id", orgId)
    .order("orden", { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextOrden = (maxOrden?.orden ?? -1) + 1

  // Limitar nombre tras añadir sufijo (DB caps a 160; ajuste defensivo)
  const baseNombre = original.nombre.slice(0, 150)
  const nombreCopia = `${baseNombre} (copia)`

  const { id: _id, created_at: _ca, updated_at: _ua, ...rest } = original

  const { data: nuevo, error } = await supabaseAdmin
    .from("catalogo_items")
    .insert({
      ...rest,
      nombre: nombreCopia,
      orden: nextOrden,
      destacado: false,
      activo: false, // duplicado nace inactivo para revisar antes de publicar
    })
    .select("*")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await revalidateCatalogo(orgId, { itemId: nuevo?.id })
  return NextResponse.json({ item: nuevo }, { status: 201 })
}
