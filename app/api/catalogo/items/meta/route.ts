// app/api/catalogo/items/meta/route.ts
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const org = auth.organizationId!

  const [tagsRes, sinImgRes] = await Promise.all([
    supabaseAdmin.from("catalogo_items").select("etiquetas").eq("organization_id", org),
    supabaseAdmin
      .from("catalogo_items")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org)
      .eq("activo", true)
      .is("imagen_url", null),
  ])

  const tags = Array.from(
    new Set((tagsRes.data ?? []).flatMap((r: { etiquetas: string[] | null }) => r.etiquetas ?? [])),
  ).sort((a, b) => a.localeCompare(b))

  return NextResponse.json({ tags, sinImagenCount: sinImgRes.count ?? 0 })
}
