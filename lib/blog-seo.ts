// Structured data (schema.org BlogPosting) para los posts del blog.
// Se mantiene como función pura, sin dependencias de Next, para que el
// componente <BlogPostingJsonLd> la serialice y los tests la validen aislada.

const SITE_URL = "https://stapp.com.ar"

export interface BlogPostingSchemaInput {
  slug: string
  title: string
  excerpt: string
  image: string
  date: string
  updatedAt?: string
  category: string
  keywords: string[]
}

// Convierte una imagen relativa a URL absoluta; deja las absolutas intactas.
function toAbsoluteUrl(src: string): string {
  if (/^https?:\/\//.test(src)) return src
  return `${SITE_URL}${src.startsWith("/") ? "" : "/"}${src}`
}

export function blogPostingSchema(
  post: BlogPostingSchemaInput
): Record<string, unknown> {
  const url = `${SITE_URL}/empresa/blog/${post.slug}`

  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${url}/#article`,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    headline: post.title,
    description: post.excerpt,
    image: toAbsoluteUrl(post.image),
    datePublished: post.date,
    dateModified: post.updatedAt ?? post.date,
    author: {
      "@type": "Organization",
      name: "STApp",
      url: SITE_URL,
    },
    publisher: {
      "@type": "Organization",
      name: "STApp",
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/icon-512.png`,
        width: 512,
        height: 512,
      },
    },
    articleSection: post.category,
    keywords: post.keywords.join(", "),
    inLanguage: "es-AR",
  }
}
