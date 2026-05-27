import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export const runtime = "nodejs"

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  if (!slug || !/^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/.test(slug)) {
    return NextResponse.json({ error: "Slug inválido" }, { status: 400 })
  }

  const { data: config } = await supabaseAdmin
    .from("catalogo_config")
    .select("titulo, color_primary, activo, organization_id")
    .eq("slug", slug)
    .maybeSingle()

  if (!config || !config.activo) {
    return NextResponse.json({ error: "Catálogo no disponible" }, { status: 404 })
  }

  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("nombre, nombre_mostrar, logo_url")
    .eq("id", config.organization_id)
    .single()

  const name = config.titulo || org?.nombre_mostrar || org?.nombre || "Catálogo"
  const shortName = (name.length > 12 ? name.slice(0, 12) : name).trim()
  const themeColor = config.color_primary || "#2563eb"
  const startUrl = `/catalogo/${slug}`

  // Endpoint dedicado genera PNGs cuadrados con safe-zone correcto.
  // Chrome rechaza el install prompt si los icons no son cuadrados verdaderos
  // o si "maskable" no tiene padding suficiente. Antes apuntábamos todos al
  // mismo logo (no cuadrado) o a la OG (1200×630).
  const iconBase = `/api/public/catalogo/${slug}/icon`

  const manifest = {
    name,
    short_name: shortName,
    description: `Catálogo de ${org?.nombre_mostrar || org?.nombre || "productos y servicios"}`,
    start_url: startUrl,
    scope: startUrl,
    id: startUrl,
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: themeColor,
    lang: "es",
    dir: "ltr",
    categories: ["business", "shopping"],
    icons: [
      {
        src: `${iconBase}/192`,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `${iconBase}/384`,
        sizes: "384x384",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `${iconBase}/512`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `${iconBase}/512-maskable`,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  }

  return NextResponse.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=300, s-maxage=600",
    },
  })
}
