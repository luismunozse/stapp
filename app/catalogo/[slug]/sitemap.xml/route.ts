import { supabaseAdmin } from "@/lib/supabase"

type PageProps = { params: Promise<{ slug: string }> }

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function urlEntry(loc: string, lastmod?: string, changefreq?: string, priority?: string) {
  return `  <url>
    <loc>${xmlEscape(loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ""}${
      changefreq ? `\n    <changefreq>${changefreq}</changefreq>` : ""
    }${priority ? `\n    <priority>${priority}</priority>` : ""}
  </url>`
}

// Sitemap dedicado del catálogo público. Útil para:
// 1. Que crawlers que entran a /catalogo/[slug] descubran rápido todos los items.
// 2. Que el dueño del catálogo lo pueda enviar a Search Console o referenciarlo
//    desde su sitio externo si linkea a este catálogo.
export async function GET(_req: Request, { params }: PageProps) {
  const { slug } = await params
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://stapp.com.ar"

  if (!/^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/.test(slug)) {
    return new Response("Not Found", { status: 404 })
  }

  const { data: config } = await supabaseAdmin
    .from("catalogo_config")
    .select("organization_id, activo, updated_at")
    .eq("slug", slug)
    .maybeSingle()

  if (!config || !config.activo) {
    return new Response("Not Found", { status: 404 })
  }

  const orgId = config.organization_id

  const [{ data: items }, { data: cats }] = await Promise.all([
    supabaseAdmin
      .from("catalogo_items")
      .select("id, updated_at")
      .eq("organization_id", orgId)
      .eq("activo", true)
      .limit(50000),
    supabaseAdmin
      .from("catalogo_categorias")
      .select("slug, updated_at")
      .eq("organization_id", orgId)
      .eq("activo", true)
      .not("slug", "is", null)
      .limit(5000),
  ])

  const entries: string[] = []

  // Root catálogo
  entries.push(
    urlEntry(
      `${baseUrl}/catalogo/${slug}`,
      new Date(config.updated_at).toISOString(),
      "weekly",
      "1.0"
    )
  )

  // Categorías landing
  for (const c of cats ?? []) {
    if (!c.slug) continue
    entries.push(
      urlEntry(
        `${baseUrl}/catalogo/${slug}/c/${c.slug}`,
        new Date(c.updated_at).toISOString(),
        "weekly",
        "0.8"
      )
    )
  }

  // Items individuales
  for (const it of items ?? []) {
    entries.push(
      urlEntry(
        `${baseUrl}/catalogo/${slug}/${it.id}`,
        new Date(it.updated_at).toISOString(),
        "weekly",
        "0.7"
      )
    )
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>`

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=600, stale-while-revalidate=3600",
    },
  })
}
