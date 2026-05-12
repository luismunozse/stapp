import type { MetadataRoute } from "next"
import { blogPosts } from "@/lib/blog-data"
import { useCases } from "@/lib/use-cases-data"
import { supabaseAdmin } from "@/lib/supabase"

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://stapp.com.ar"

  // URLs estaticas
  const staticUrls: MetadataRoute.Sitemap = [
    // Pagina principal
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    // Precios - página de alta conversión
    {
      url: `${baseUrl}/precios`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    // Registro - landing de conversión
    {
      url: `${baseUrl}/registro`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    // Ayuda
    {
      url: `${baseUrl}/ayuda`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: `${baseUrl}/ayuda/manual`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
    // Descargas
    {
      url: `${baseUrl}/descargar/android`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
    // Empresa
    {
      url: `${baseUrl}/empresa/sobre-nosotros`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${baseUrl}/empresa/contacto`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/empresa/blog`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${baseUrl}/empresa/trabaja-con-nosotros`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
    // Legal
    {
      url: `${baseUrl}/legal/privacidad`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/legal/terminos`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/legal/cookies`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ]

  // URLs dinamicas del blog
  const blogUrls: MetadataRoute.Sitemap = blogPosts.map((post) => ({
    url: `${baseUrl}/empresa/blog/${post.slug}`,
    lastModified: new Date(post.date),
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }))

  // URLs de casos de uso
  const useCaseUrls: MetadataRoute.Sitemap = [
    {
      url: `${baseUrl}/casos-de-uso`,
      lastModified: new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    },
    ...useCases.map((uc) => ({
      url: `${baseUrl}/casos-de-uso/${uc.slug}`,
      lastModified: new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ]

  // Catálogos públicos activos (1 query catálogos + 1 query items en batch)
  const catalogoUrls: MetadataRoute.Sitemap = []
  try {
    const { data: catalogos } = await supabaseAdmin
      .from("catalogo_config")
      .select("slug, updated_at, organization_id")
      .eq("activo", true)

    const cats = catalogos ?? []
    const orgIds = cats.map((c) => c.organization_id)
    const slugByOrg = new Map(cats.map((c) => [c.organization_id, c.slug]))

    for (const cat of cats) {
      catalogoUrls.push({
        url: `${baseUrl}/catalogo/${cat.slug}`,
        lastModified: new Date(cat.updated_at),
        changeFrequency: "weekly",
        priority: 0.7,
      })
    }

    if (orgIds.length > 0) {
      const { data: items } = await supabaseAdmin
        .from("catalogo_items")
        .select("id, updated_at, organization_id")
        .in("organization_id", orgIds)
        .eq("activo", true)
        .limit(50000)

      for (const it of items ?? []) {
        const slug = slugByOrg.get(it.organization_id)
        if (!slug) continue
        catalogoUrls.push({
          url: `${baseUrl}/catalogo/${slug}/${it.id}`,
          lastModified: new Date(it.updated_at),
          changeFrequency: "weekly",
          priority: 0.6,
        })
      }
    }
  } catch (err) {
    console.error("sitemap: error fetching catalogs", err)
  }

  return [...staticUrls, ...blogUrls, ...useCaseUrls, ...catalogoUrls]
}
