import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  if (!slug || !/^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/.test(slug)) {
    return NextResponse.json({ error: "Slug inválido" }, { status: 400 })
  }

  const { data: config, error } = await supabaseAdmin
    .from("catalogo_config")
    .select("slug, titulo, descripcion, color_primary, whatsapp, activo, organization_id")
    .eq("slug", slug)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!config || !config.activo) {
    return NextResponse.json({ error: "Catálogo no encontrado" }, { status: 404 })
  }

  const [{ data: org }, { data: categorias }] = await Promise.all([
    supabaseAdmin
      .from("organizations")
      .select("id, nombre, nombre_mostrar, logo_url, telefono, moneda")
      .eq("id", config.organization_id)
      .single(),
    supabaseAdmin
      .from("catalogo_categorias")
      .select("id, nombre, descripcion, imagen_url, orden")
      .eq("organization_id", config.organization_id)
      .eq("activo", true)
      .order("orden", { ascending: true }),
  ])

  return NextResponse.json({
    config: {
      slug: config.slug,
      titulo: config.titulo,
      descripcion: config.descripcion,
      color_primary: config.color_primary,
      whatsapp: config.whatsapp,
    },
    organizacion: org,
    categorias: categorias ?? [],
  })
}
