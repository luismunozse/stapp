import type { MetadataRoute } from "next"
import { blogPosts } from "@/lib/blog-data"
import { useCases } from "@/lib/use-cases-data"

export default function sitemap(): MetadataRoute.Sitemap {
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

  return [...staticUrls, ...blogUrls, ...useCaseUrls]
}
